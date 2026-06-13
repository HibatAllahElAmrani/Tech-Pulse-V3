import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDefaultGitHubService } from '../services/github.js';
import type { Queue } from 'bullmq';
import type { CollectJobData } from '../workers/metricsWorker.js';

interface ProjectsRoutesOpts {
  metricsQueue: Queue<CollectJobData>;
}

const addProjectSchema = z.object({
  // Either "owner/repo" or full GitHub URL
  identifier: z.string().min(3),
});

function parseIdentifier(input: string): { owner: string; repo: string } | null {
  // Try GitHub URL
  const urlMatch = input.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };
  }
  // Try owner/repo
  const slashMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
  return null;
}

const projectsRoutes: FastifyPluginAsync<ProjectsRoutesOpts> = async (
  fastify,
  { metricsQueue }
) => {
  // ------------------------------------------------------------
  // POST /projects — Add project to watchlist
  // ------------------------------------------------------------
  fastify.post('/projects', async (request, reply) => {
    const parsed = addProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid input', details: parsed.error.format() };
    }

    const ids = parseIdentifier(parsed.data.identifier);
    if (!ids) {
      reply.code(400);
      return { error: 'Could not parse identifier (expected owner/repo or GitHub URL)' };
    }

    // Fetch metadata from GitHub
    let metrics;
    try {
      const gh = getDefaultGitHubService();
      metrics = await gh.getRepoMetrics(ids.owner, ids.repo);
    } catch (err) {
      reply.code(404);
      return { error: 'Repository not found on GitHub', details: String(err) };
    }

    // Upsert project
    const { rows } = await fastify.pg.query<{ id: string }>(
      `INSERT INTO projects
         (github_id, owner, repo, description, language, homepage, is_archived, is_fork, project_created_at, last_pushed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (github_id) DO UPDATE
         SET description = EXCLUDED.description,
             language = EXCLUDED.language,
             last_pushed_at = EXCLUDED.last_pushed_at
       RETURNING id`,
      [
        metrics.github_id,
        metrics.owner,
        metrics.repo,
        metrics.description,
        metrics.language,
        metrics.homepage,
        metrics.is_archived,
        metrics.is_fork,
        metrics.project_created_at,
        metrics.last_pushed_at,
      ]
    );

    const projectId = rows[0].id;

    // Enqueue immediate metrics collection
    await metricsQueue.add(
      `collect:initial:${projectId}`,
      { projectId, owner: metrics.owner, repo: metrics.repo, priority: 'low' },
      { priority: 1 }
    );

    return {
      id: projectId,
      owner: metrics.owner,
      repo: metrics.repo,
      stars: metrics.stars,
      forks: metrics.forks,
      open_issues: metrics.open_issues,
      message: 'Project added. Initial metrics collection scheduled.',
    };
  });

  // ------------------------------------------------------------
  // GET /projects — List all watched projects
  // ------------------------------------------------------------
  fastify.get('/projects', async () => {
    const { rows } = await fastify.pg.query(
      `SELECT
          p.id, p.owner, p.repo, p.full_name, p.description, p.language,
          p.is_archived, p.last_pushed_at,
          (SELECT row_to_json(latest) FROM (
             SELECT stars, forks, open_issues, open_prs, time
             FROM metrics_snapshots
             WHERE project_id = p.id
             ORDER BY time DESC LIMIT 1
          ) latest) AS latest_metrics
       FROM projects p
       ORDER BY p.created_at DESC`
    );
    return { projects: rows };
  });

  // ------------------------------------------------------------
  // GET /projects/:id — Project details
  // ------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT * FROM projects WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return rows[0];
  });

  // ------------------------------------------------------------
  // GET /projects/:id/metrics — time-series history
  // ------------------------------------------------------------
  fastify.get<{
    Params: { id: string };
    Querystring: { range?: string };
  }>('/projects/:id/metrics', async (request) => {
    const { id } = request.params;
    const range = request.query.range ?? '30d';
    const interval = range === '7d' ? '7 days' : range === '90d' ? '90 days' : '30 days';

    const { rows } = await fastify.pg.query(
      `SELECT time, stars, forks, open_issues, open_prs
         FROM metrics_snapshots
        WHERE project_id = $1
          AND time > NOW() - $2::interval
        ORDER BY time ASC`,
      [id, interval]
    );
    return { projectId: id, range, points: rows };
  });

  // ------------------------------------------------------------
  // GET /projects/:id/contributors
  // ------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/projects/:id/contributors', async (request) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT login, avatar_url, contributions
         FROM contributors
        WHERE project_id = $1
        ORDER BY contributions DESC
        LIMIT 30`,
      [id]
    );
    return { projectId: id, contributors: rows };
  });

  // ------------------------------------------------------------
  // GET /projects/:id/commits/heatmap — last 90 days
  // ------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/projects/:id/commits/heatmap', async (request) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT day, commit_count
         FROM commits_daily
        WHERE project_id = $1
          AND day > CURRENT_DATE - INTERVAL '90 days'
        ORDER BY day ASC`,
      [id]
    );
    return { projectId: id, days: rows };
  });

  // ------------------------------------------------------------
  // DELETE /projects/:id
  // ------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await fastify.pg.query(`DELETE FROM projects WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return { success: true };
  });
};

export default projectsRoutes;
