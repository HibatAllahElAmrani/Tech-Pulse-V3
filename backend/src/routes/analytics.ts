import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { cachedJson } from '../lib/cache.js';
import { aiForecast } from '../services/forecastClient.js';
import type { SignalSource, Tech } from '../services/taxonomy.js';
import { compositeOf } from '../services/taxonomy.js';
import { lastMonths, nextMonths, lastDays } from '../lib/months.js';
import { dailyCommitTotals } from '../services/aggregations.js';
import {
  monthlyScores,
  sourceMonthlyVolumes,
  geoCounts,
  toShares,
  toChoropleth,
  globeData,
  countrySubScoresReal,
  scoreFlowReal,
  ecosystemTreemapReal,
  landscapeBubblesReal,
  raceFramesReal,
} from '../services/realAnalytics.js';

const slugSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
const techParam = z.object({ slug: slugSchema });
const categoryQuery = z.object({ category: slugSchema.optional() });
const subscoresQuery = z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional() });
const signalGeoQuery = z.object({
  category: slugSchema,
  // Seule lentille réelle : la localisation des contributeurs GitHub. Les
  // anciennes valeurs restent acceptées (compat URL) et servent la même donnée.
  signal: z.enum(['survey', 'github-locations', 'trends']).default('github-locations'),
});
const compareQuery = z.object({
  techs: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(slugSchema).min(2).max(5)),
});

const CACHE_TTL = 300; // purgé par les cycles de collecte à chaque rafraîchissement

function badRequest(reply: FastifyReply, details: unknown) {
  reply.code(400);
  return { error: 'Invalid input', details };
}

/**
 * Analytique 100 % data-driven : technology_monthly, source_monthly,
 * commits_daily et contributor_geo — plus aucun générateur synthétique.
 */
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolveTech(slugRaw: unknown, reply: FastifyReply): Promise<Tech | null> {
    const parsed = techParam.safeParse({ slug: slugRaw });
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid technology slug', details: parsed.error.format() });
      return null;
    }
    const tech = await fastify.taxonomy.techBySlug(parsed.data.slug);
    if (!tech) {
      reply.code(404).send({ error: 'Technology not found' });
      return null;
    }
    return tech;
  }

  // ── GET /technologies/:slug/series — trajectoire 12 mois du composite ──
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug/series', async (request, reply) => {
    const tech = await resolveTech(request.params.slug, reply);
    if (!tech) return reply;
    return cachedJson(fastify, `series:${tech.slug}`, CACHE_TTL, async () => {
      const months = lastMonths(12);
      const series = await monthlyScores(fastify.pg, [tech], months.map((m) => m.key));
      return {
        slug: tech.slug,
        months: months.map((m) => m.label),
        values: series.get(tech.slug)!,
      };
    });
  });

  // ── GET /technologies/:slug/sources/series — volumes par connecteur ────
  fastify.get<{ Params: { slug: string } }>(
    '/technologies/:slug/sources/series',
    async (request, reply) => {
      const tech = await resolveTech(request.params.slug, reply);
      if (!tech) return reply;
      return cachedJson(fastify, `srcseries:${tech.slug}`, CACHE_TTL, async () => {
        const sources = await fastify.taxonomy.sources();
        const months = lastMonths(12);
        const volumes = await sourceMonthlyVolumes(fastify.pg, tech.slug, months.map((m) => m.key));
        return {
          slug: tech.slug,
          months: months.map((m) => m.label),
          sources: tech.sources.map((id) => {
            const meta = sources.find((s) => s.id === id)!;
            return {
              id,
              name: meta.name,
              color: meta.color,
              unit: meta.unit,
              measures: meta.measures,
              freshness: meta.freshness,
              values: volumes.get(id) ?? months.map(() => 0),
            };
          }),
        };
      });
    }
  );

  // ── GET /technologies/:slug/geo — parts pays + choroplèthe ─────────────
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug/geo', async (request, reply) => {
    const tech = await resolveTech(request.params.slug, reply);
    if (!tech) return reply;
    return cachedJson(fastify, `geo:${tech.slug}`, CACHE_TTL, async () => {
      const countries = await fastify.taxonomy.countries();
      const { counts, located, total } = await geoCounts(fastify.pg, [tech.slug]);
      return {
        slug: tech.slug,
        shares: toShares(counts, located, total, countries),
        choropleth: toChoropleth(counts, countries),
      };
    });
  });

  // ── GET /technologies/:slug/subscores?country=XX — tilt local réel ─────
  fastify.get<{ Params: { slug: string }; Querystring: { country?: string } }>(
    '/technologies/:slug/subscores',
    async (request, reply) => {
      const tech = await resolveTech(request.params.slug, reply);
      if (!tech) return reply;
      const q = subscoresQuery.safeParse(request.query);
      if (!q.success) return badRequest(reply, q.error.format());

      if (!q.data.country) {
        return { slug: tech.slug, country: null, subScores: tech.subScores, score: tech.score };
      }
      const country = await fastify.taxonomy.countryByIso(q.data.country);
      if (!country) {
        reply.code(404);
        return { error: 'Country not found' };
      }
      const subScores = await countrySubScoresReal(fastify.pg, tech, country.iso2);
      return { slug: tech.slug, country: country.iso2, subScores, score: compositeOf(subScores) };
    }
  );

  // ── GET /technologies/:slug/forecast — Holt (ai-service) sur série réelle
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug/forecast', async (request, reply) => {
    const tech = await resolveTech(request.params.slug, reply);
    if (!tech) return reply;
    return cachedJson(fastify, `forecast:${tech.slug}`, 120, async () => {
      const months = lastMonths(12);
      const fMonths = nextMonths(6);
      const series = await monthlyScores(fastify.pg, [tech], months.map((m) => m.key));
      const hist = series.get(tech.slug)!;
      const allMonths = [...months.map((m) => m.label), ...fMonths.map((m) => m.label)];

      const ai = await aiForecast(hist, 6);
      if (ai) {
        return {
          slug: tech.slug,
          forecastMonths: fMonths.map((m) => m.label),
          months: allMonths,
          hist,
          mid: ai.mid,
          lo: ai.lo,
          hi: ai.hi,
          model: ai.model,
          params: ai.params,
        };
      }
      // Service IA indisponible : persistance naïve (dernière valeur, bande
      // croissante) — un modèle de repli, pas une donnée inventée.
      fastify.log.warn({ slug: tech.slug }, 'AI service unreachable — naive forecast fallback');
      const lastValue = hist[hist.length - 1];
      const mid: number[] = [];
      const lo: number[] = [];
      const hi: number[] = [];
      for (let i = 1; i <= 6; i++) {
        const band = 1 + i * 1.2;
        mid.push(lastValue);
        lo.push(Math.max(5, Math.round((lastValue - band) * 10) / 10));
        hi.push(Math.min(99, Math.round((lastValue + band) * 10) / 10));
      }
      return {
        slug: tech.slug,
        forecastMonths: fMonths.map((m) => m.label),
        months: allMonths,
        hist,
        mid,
        lo,
        hi,
        model: 'naive-persistence',
      };
    });
  });

  // ── GET /technologies/:slug/calendar — heatmap commits réels ───────────
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug/calendar', async (request, reply) => {
    const tech = await resolveTech(request.params.slug, reply);
    if (!tech) return reply;
    return cachedJson(fastify, `calendar:${tech.slug}`, CACHE_TTL, async () => {
      const real = await dailyCommitTotals(fastify.pg, tech.slug, 182);
      const days: [string, number][] = lastDays(182).map((d) => [d, real.get(d) ?? 0]);
      return { slug: tech.slug, days };
    });
  });

  // ── GET /technologies/:slug/flow — sankey pondéré par volumes réels ────
  fastify.get<{ Params: { slug: string } }>('/technologies/:slug/flow', async (request, reply) => {
    const tech = await resolveTech(request.params.slug, reply);
    if (!tech) return reply;
    return cachedJson(fastify, `flow:${tech.slug}`, CACHE_TTL, async () => ({
      slug: tech.slug,
      ...scoreFlowReal(tech),
    }));
  });

  // ── GET /analytics/race?category= — frames depuis les scores mensuels ──
  fastify.get<{ Querystring: { category?: string } }>('/analytics/race', async (request, reply) => {
    const q = categoryQuery.safeParse(request.query);
    if (!q.success) return badRequest(reply, q.error.format());
    const key = `race:${q.data.category ?? 'all'}`;
    return cachedJson(fastify, key, CACHE_TTL, async () => {
      const all = await fastify.taxonomy.technologies();
      const techs = q.data.category ? all.filter((t) => t.category === q.data.category) : all;
      const months = lastMonths(12);
      const series = await monthlyScores(fastify.pg, techs, months.map((m) => m.key));
      return {
        category: q.data.category ?? null,
        frames: raceFramesReal(techs, series, months.map((m) => m.label)),
      };
    });
  });

  // ── GET /analytics/treemap ──────────────────────────────────────────────
  fastify.get('/analytics/treemap', async () =>
    cachedJson(fastify, 'treemap', CACHE_TTL, async () => ({
      tree: ecosystemTreemapReal(await fastify.taxonomy.technologies()),
    }))
  );

  // ── GET /analytics/landscape ───────────────────────────────────────────
  fastify.get('/analytics/landscape', async () =>
    cachedJson(fastify, 'landscape', CACHE_TTL, async () => ({
      bubbles: landscapeBubblesReal(await fastify.taxonomy.technologies()),
    }))
  );

  // ── GET /analytics/globe — densités réelles de contributeurs ───────────
  fastify.get('/analytics/globe', async () =>
    cachedJson(fastify, 'globe', CACHE_TTL, async () =>
      globeData(fastify.pg, await fastify.taxonomy.countries())
    )
  );

  // ── GET /analytics/geo/category/:slug — choroplèthe de catégorie ───────
  fastify.get<{ Params: { slug: string } }>('/analytics/geo/category/:slug', async (request, reply) => {
    const parsed = techParam.safeParse(request.params);
    if (!parsed.success) return badRequest(reply, parsed.error.format());
    const category = await fastify.taxonomy.categoryBySlug(parsed.data.slug);
    if (!category) {
      reply.code(404);
      return { error: 'Category not found' };
    }
    return cachedJson(fastify, `catgeo:${category.slug}`, CACHE_TTL, async () => {
      const [techs, countries] = await Promise.all([
        fastify.taxonomy.techsByCategory(category.slug),
        fastify.taxonomy.countries(),
      ]);
      const { counts } = await geoCounts(fastify.pg, techs.map((t) => t.slug));
      return { category: category.slug, choropleth: toChoropleth(counts, countries) };
    });
  });

  // ── GET /analytics/geo?category=&signal= — carte /map (signal réel) ────
  fastify.get<{ Querystring: { category: string; signal?: string } }>(
    '/analytics/geo',
    async (request, reply) => {
      const q = signalGeoQuery.safeParse(request.query);
      if (!q.success) return badRequest(reply, q.error.format());
      const category = await fastify.taxonomy.categoryBySlug(q.data.category);
      if (!category) {
        reply.code(404);
        return { error: 'Category not found' };
      }
      const signal = q.data.signal as SignalSource;
      return cachedJson(fastify, `signalgeo:${category.slug}`, CACHE_TTL, async () => {
        const [techs, countries] = await Promise.all([
          fastify.taxonomy.techsByCategory(category.slug),
          fastify.taxonomy.countries(),
        ]);
        const { counts, located, total } = await geoCounts(fastify.pg, techs.map((t) => t.slug));
        const confidence = total > 0 ? Math.round((located / total) * 100) / 100 : 0;
        return {
          category: category.slug,
          signal,
          choropleth: toChoropleth(counts, countries).map((d) => ({ ...d, confidence })),
        };
      });
    }
  );

  // ── GET /analytics/compare?techs=a,b — bundle radar + lignes + table ───
  fastify.get<{ Querystring: { techs: string } }>('/analytics/compare', async (request, reply) => {
    const q = compareQuery.safeParse(request.query);
    if (!q.success) return badRequest(reply, q.error.format());

    const resolved = await Promise.all(q.data.techs.map((s) => fastify.taxonomy.techBySlug(s)));
    const missing = q.data.techs.filter((_, i) => !resolved[i]);
    if (missing.length > 0) {
      reply.code(404);
      return { error: 'Unknown technologies', missing };
    }
    const techs = resolved as Tech[];
    const months = lastMonths(12);
    const series = await monthlyScores(fastify.pg, techs, months.map((m) => m.key));
    return {
      months: months.map((m) => m.label),
      technologies: techs,
      series: techs.map((t) => ({
        slug: t.slug,
        name: t.name,
        color: t.color,
        values: series.get(t.slug)!,
      })),
    };
  });
};

export default analyticsRoutes;
