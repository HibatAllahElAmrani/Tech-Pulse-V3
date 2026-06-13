import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Queue } from 'bullmq';
import type { CollectJobData } from '../workers/metricsWorker.js';
import { cachedJson } from '../lib/cache.js';
import { getDefaultGitHubService } from '../services/github.js';
import {
  createTechnologyFromRepo,
  deleteCustomTechnology,
  detectCategory,
  CustomTechError,
} from '../services/customTech.js';
import { computeSubscores, materializeMonthlyScores } from '../workers/connectorsRefresh.js';

interface ManageRoutesOpts {
  metricsQueue: Queue<CollectJobData>;
}

const searchQuery = z.object({ q: z.string().min(2).max(100) });
const addTechBody = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  category: z.string().regex(/^[a-z0-9-]+$/).optional(),
});
const slugParam = z.object({ slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) });

/**
 * Gestion dynamique du catalogue — la barre de recherche globale.
 *
 *   GET    /search?q=            → technos suivies + repos GitHub
 *   POST   /technologies         → ajoute un repo comme technologie suivie
 *   DELETE /technologies/:slug   → retire une techno ajoutée (is_custom)
 */
const manageRoutes: FastifyPluginAsync<ManageRoutesOpts> = async (fastify, { metricsQueue }) => {
  // ── GET /search — recherche unifiée ────────────────────────────────────
  fastify.get<{ Querystring: { q: string } }>('/search', async (request, reply) => {
    const parsed = searchQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid query', details: parsed.error.format() };
    }
    const q = parsed.data.q.trim();

    // Section 1 — technos déjà suivies (instantané, base locale).
    const techs = await fastify.taxonomy.technologies();
    const needle = q.toLowerCase();
    const technologies = techs
      .filter((t) => t.slug.includes(needle) || t.name.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((t) => ({ slug: t.slug, name: t.name, category: t.category, color: t.color, score: t.score }));

    // Section 2 — repos GitHub (Search API, cache 60 s pour le quota).
    const repositories = await cachedJson(fastify, `search:${needle}`, 60, async () => {
      try {
        const gh = getDefaultGitHubService();
        const results = await gh.searchRepos(q, 5);
        const tracked = new Set(
          (
            await fastify.pg.query<{ external_id: string }>(
              `SELECT LOWER(i.external_id) AS external_id
                 FROM items i
                 JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
                WHERE i.technology_id IS NOT NULL`
            )
          ).rows.map((r) => r.external_id)
        );
        return results.map((r) => ({
          fullName: r.full_name,
          owner: r.owner,
          repo: r.repo,
          description: r.description,
          language: r.language,
          stars: r.stars,
          suggestedCategory: detectCategory(r.topics, r.language),
          tracked: tracked.has(r.full_name.toLowerCase()),
        }));
      } catch (err) {
        fastify.log.warn({ err, q }, 'GitHub search failed (quota ?) — section repos vide');
        return [];
      }
    });

    return { query: q, technologies, repositories };
  });

  // ── POST /technologies — repo GitHub → technologie suivie ──────────────
  fastify.post('/technologies', async (request, reply) => {
    const parsed = addTechBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid input', details: parsed.error.format() };
    }
    try {
      const created = await createTechnologyFromRepo(
        fastify,
        metricsQueue,
        parsed.data.owner,
        parsed.data.repo,
        parsed.data.category
      );
      // Scores immédiats depuis les signaux déjà connus (stars/forks du repo) ;
      // affinés ensuite par les cycles de collecte. Sans cela, la techno
      // resterait au neutre (50) jusqu'à 30 min.
      try {
        await computeSubscores(fastify);
        await materializeMonthlyScores(fastify);
        fastify.taxonomy.invalidate();
      } catch (err) {
        fastify.log.warn({ err }, 'Recalcul immédiat post-ajout en échec (rattrapé au prochain cycle)');
      }
      reply.code(201);
      return { ...created, message: 'Technology added — initial collection scheduled.' };
    } catch (err) {
      if (err instanceof CustomTechError) {
        reply.code(err.statusCode);
        return { error: err.message };
      }
      throw err;
    }
  });

  // ── DELETE /technologies/:slug — retire une techno ajoutée ─────────────
  fastify.delete<{ Params: { slug: string } }>('/technologies/:slug', async (request, reply) => {
    const parsed = slugParam.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid slug', details: parsed.error.format() };
    }
    try {
      await deleteCustomTechnology(fastify, parsed.data.slug);
      return { slug: parsed.data.slug, message: 'Technology removed.' };
    } catch (err) {
      if (err instanceof CustomTechError) {
        reply.code(err.statusCode);
        return { error: err.message };
      }
      throw err;
    }
  });
};

export default manageRoutes;
