import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUBSCORE_META } from '../services/taxonomy.js';
import type { Tech } from '../services/taxonomy.js';
import { lastMonths } from '../lib/months.js';
import { monthlyScores, realSignalCount } from '../services/realAnalytics.js';

const categoryParam = z.object({ slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) });
const techParam = z.object({ slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) });
const caseParam = z.object({ id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) });
const techListQuery = z.object({ category: z.string().regex(/^[a-z0-9-]+$/).optional() });

/**
 * Sérialisation Tech enrichie d'une `sparkline` : la trajectoire 12 mois du
 * score, lue depuis technology_monthly (scores réels matérialisés). Un seul
 * SELECT pour tout le lot — évite N requêtes.
 */
async function withSparklines(fastify: FastifyInstance, techs: Tech[]) {
  const monthKeys = lastMonths(12).map((m) => m.key);
  const series = await monthlyScores(fastify.pg, techs, monthKeys);
  return techs.map((t) => ({ ...t, sparkline: series.get(t.slug) ?? monthKeys.map(() => t.score) }));
}

/**
 * Catalogue — la taxonomie servie dans les formes EXACTES du frontend
 * (frontend/src/mocks/{technologies,countries,sources,cases}.ts).
 */
const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /bootstrap — bundle d'amorçage de la SPA ───────────────────────
  // Un seul aller-retour fournit tout ce dont l'app a besoin au premier
  // rendu : mois, compteurs, catégories AVEC leurs technologies (sparkline
  // incluse), pays, sources, récits et pondérations du score. Évite une
  // cascade de 6+ requêtes au chargement (anti-chattiness).
  fastify.get('/bootstrap', async () => {
    const [techs, countries, categories, sources, cases] = await Promise.all([
      fastify.taxonomy.technologies(),
      fastify.taxonomy.countries(),
      fastify.taxonomy.categories(),
      fastify.taxonomy.sources(),
      fastify.taxonomy.cases(),
    ]);
    const ranked = await withSparklines(fastify, techs);
    return {
      months: lastMonths(12).map((m) => m.label),
      headline: {
        signalsIndexed: await realSignalCount(fastify.pg),
        technologies: techs.length,
        categories: categories.length,
        countries: countries.length,
        sources: sources.length,
      },
      categories: categories.map((c) => ({
        ...c,
        technologies: ranked
          .filter((t) => t.category === c.slug)
          .sort((a, b) => b.score - a.score),
      })),
      countries,
      sources,
      cases,
      subscoreMeta: SUBSCORE_META,
    };
  });

  // ── GET /stats/headline — compteurs animés de la home ─────────────────
  fastify.get('/stats/headline', async () => {
    const [techs, countries, categories, sources] = await Promise.all([
      fastify.taxonomy.technologies(),
      fastify.taxonomy.countries(),
      fastify.taxonomy.categories(),
      fastify.taxonomy.sources(),
    ]);
    return {
      signalsIndexed: await realSignalCount(fastify.pg),
      technologies: techs.length,
      categories: categories.length,
      countries: countries.length,
      sources: sources.length,
    };
  });

  // ── GET /countries ─────────────────────────────────────────────────────
  fastify.get('/countries', async () => ({ countries: await fastify.taxonomy.countries() }));

  // ── GET /sources — métadonnées des 5 connecteurs ───────────────────────
  fastify.get('/sources', async () => ({ sources: await fastify.taxonomy.sources() }));

  // ── GET /meta/subscores — pondérations du composite (35/25/25/15) ──────
  fastify.get('/meta/subscores', async () => ({ subscores: SUBSCORE_META }));

  // ── GET /categories ────────────────────────────────────────────────────
  fastify.get('/categories', async () => {
    const [categories, techs] = await Promise.all([
      fastify.taxonomy.categories(),
      fastify.taxonomy.technologies(),
    ]);
    return {
      categories: categories.map((c) => ({
        ...c,
        technologies: techs.filter((t) => t.category === c.slug).length,
      })),
    };
  });

  // ── GET /categories/:slug — catégorie + classement de ses technos ──────
  fastify.get<{ Params: { slug: string } }>('/categories/:slug', async (request, reply) => {
    const parsed = categoryParam.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid category slug', details: parsed.error.format() };
    }
    const category = await fastify.taxonomy.categoryBySlug(parsed.data.slug);
    if (!category) {
      reply.code(404);
      return { error: 'Category not found' };
    }
    const technologies = await withSparklines(
      fastify,
      await fastify.taxonomy.techsByCategory(category.slug)
    );
    return { category, technologies };
  });

  // ── GET /technologies?category= — Tech[] forme frontend, triées score ──
  fastify.get<{ Querystring: { category?: string } }>('/technologies', async (request, reply) => {
    const parsed = techListQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid query', details: parsed.error.format() };
    }
    const technologies = await withSparklines(
      fastify,
      parsed.data.category
        ? await fastify.taxonomy.techsByCategory(parsed.data.category)
        : [...(await fastify.taxonomy.technologies())].sort((a, b) => b.score - a.score)
    );
    return { technologies };
  });

  // ── GET /technologies/:slug — profil complet d'une techno ──────────────
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug', async (request, reply) => {
    const parsed = techParam.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid technology slug', details: parsed.error.format() };
    }
    const tech = await fastify.taxonomy.techBySlug(parsed.data.slug);
    if (!tech) {
      reply.code(404);
      return { error: 'Technology not found' };
    }
    return (await withSparklines(fastify, [tech]))[0];
  });

  // ── GET /cases — les 4 récits guidés ───────────────────────────────────
  fastify.get('/cases', async () => ({ cases: await fastify.taxonomy.cases() }));

  // ── GET /cases/:id ──────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/cases/:id', async (request, reply) => {
    const parsed = caseParam.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid case id', details: parsed.error.format() };
    }
    const story = await fastify.taxonomy.caseById(parsed.data.id);
    if (!story) {
      reply.code(404);
      return { error: 'Case story not found' };
    }
    return story;
  });
};

export default catalogRoutes;
