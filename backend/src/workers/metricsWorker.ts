import { Queue, Worker, type Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { getDefaultGitHubService } from '../services/github.js';
import { getEnv } from '../config/env.js';

export const QUEUE_NAME = 'metrics-collection';

export interface CollectJobData {
  projectId: string;
  owner: string;
  repo: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Create the metrics collection queue.
 */
export function createMetricsQueue(): Queue<CollectJobData> {
  const env = getEnv();
  return new Queue<CollectJobData>(QUEUE_NAME, {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

/**
 * Create a worker that processes metrics jobs.
 * The worker fetches GitHub data, persists to Postgres, and publishes to Redis.
 */
export function createMetricsWorker(fastify: FastifyInstance): Worker<CollectJobData> {
  const env = getEnv();
  const gh = getDefaultGitHubService();

  const worker = new Worker<CollectJobData>(
    QUEUE_NAME,
    async (job: Job<CollectJobData>) => {
      const { projectId, owner, repo, priority } = job.data;
      fastify.log.debug({ projectId, owner, repo, priority }, '⏳ Processing job');

      // 1. Fetch core metrics + open PRs in parallel
      const [metrics, openPRs] = await Promise.all([
        gh.getRepoMetrics(owner, repo),
        gh.getOpenPRCount(owner, repo).catch(() => 0),
      ]);

      // 2. Insert into TimescaleDB hypertable
      await fastify.pg.query(
        `INSERT INTO metrics_snapshots
           (time, project_id, stars, forks, watchers, open_issues, open_prs, contributors_30d, commits_30d)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, 0, 0)
         ON CONFLICT (project_id, time) DO NOTHING`,
        [
          projectId,
          metrics.stars,
          metrics.forks,
          metrics.watchers,
          metrics.open_issues,
          openPRs,
        ]
      );

      // 3. Update project metadata
      await fastify.pg.query(
        `UPDATE projects
            SET description = $1, language = $2, is_archived = $3, last_pushed_at = $4
          WHERE id = $5`,
        [metrics.description, metrics.language, metrics.is_archived, metrics.last_pushed_at, projectId]
      );

      // 4. Cache latest in Redis (TTL 90s)
      const payload = {
        projectId,
        timestamp: new Date().toISOString(),
        metrics: {
          stars: metrics.stars,
          forks: metrics.forks,
          watchers: metrics.watchers,
          open_issues: metrics.open_issues,
          open_prs: openPRs,
        },
      };
      await fastify.redis.set(
        `project:${projectId}:latest`,
        JSON.stringify(payload),
        'EX',
        90
      );

      // 5. Publish to pub/sub for real-time push to clients
      await fastify.redisPub.publish(`project:${projectId}:update`, JSON.stringify(payload));

      // 6. For low-priority jobs, also refresh contributors + commits heatmap
      if (priority === 'low') {
        try {
          await refreshContributors(fastify, projectId, owner, repo);
          await refreshCommitsHeatmap(fastify, projectId, owner, repo);
          await refreshContributorCount(fastify, projectId, owner, repo);
        } catch (err) {
          fastify.log.warn({ err, projectId }, 'Secondary refresh failed (non-blocking)');
        }
      }

      return { success: true };
    },
    {
      connection: { host: env.REDIS_HOST, port: env.REDIS_PORT },
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    fastify.log.debug({ jobId: job.id }, '✅ Job completed');
  });
  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, '❌ Job failed');
  });

  return worker;
}

async function refreshContributors(
  fastify: FastifyInstance,
  projectId: string,
  owner: string,
  repo: string
) {
  const gh = getDefaultGitHubService();
  const contributors = await gh.getContributors(owner, repo, 30);

  for (const c of contributors) {
    await fastify.pg.query(
      `INSERT INTO contributors (project_id, login, github_id, avatar_url, contributions, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (project_id, login)
       DO UPDATE SET contributions = EXCLUDED.contributions,
                     avatar_url = EXCLUDED.avatar_url,
                     updated_at = NOW()`,
      [projectId, c.login, c.github_id, c.avatar_url, c.contributions]
    );
  }
}

/**
 * Compte TOTAL de contributeurs (header Link GitHub, 1 appel) écrit sur le
 * snapshot le plus récent — c'est lui que lisent les agrégations réelles.
 */
async function refreshContributorCount(
  fastify: FastifyInstance,
  projectId: string,
  owner: string,
  repo: string
) {
  const gh = getDefaultGitHubService();
  const total = await gh.getContributorCount(owner, repo);
  if (total > 0) {
    await fastify.pg.query(
      `UPDATE metrics_snapshots
          SET contributors_30d = $1
        WHERE project_id = $2
          AND time = (SELECT MAX(time) FROM metrics_snapshots WHERE project_id = $2)`,
      [total, projectId]
    );
  }
}

async function refreshCommitsHeatmap(
  fastify: FastifyInstance,
  projectId: string,
  owner: string,
  repo: string
) {
  const gh = getDefaultGitHubService();
  const counts = await gh.getCommitsByDay(owner, repo, 90);

  for (const [day, count] of counts.entries()) {
    await fastify.pg.query(
      `INSERT INTO commits_daily (day, project_id, commit_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, day) DO UPDATE SET commit_count = EXCLUDED.commit_count`,
      [day, projectId, count]
    );
  }
}
