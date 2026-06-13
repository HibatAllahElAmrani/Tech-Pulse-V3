import type { FastifyInstance } from 'fastify';
import { fetchTechAggregates } from '../services/aggregations.js';
import { ensureTechnologyProjects } from '../services/techProjects.js';

/**
 * Boucle de rafraîchissement : réinjecte les agrégats GitHub RÉELS dans
 * `technology_metrics` / `technology_subscores` — les tables que lit la
 * taxonomie. Tech.metrics / Tech.subScores / Tech.score deviennent alors
 * réels, et tous les écrans dérivés (ranking, treemap, landscape, flow,
 * race…) suivent sans changement de contrat.
 *
 * Règle d'honnêteté : seuls les signaux disposant d'un connecteur réel sont
 * écrasés (stars, forks, contributeurs, commits → activity/growth). Les
 * signaux sans connecteur (downloads npm/PyPI, questions Stack Overflow,
 * likes HF → adoption/community) gardent leurs valeurs seedées jusqu'au
 * branchement de leur connecteur.
 */

export async function refreshTechnologyAggregates(fastify: FastifyInstance): Promise<number> {
  const aggs = await fetchTechAggregates(fastify.pg);
  if (aggs.length === 0) {
    fastify.log.info('📊 Agrégats réels : aucune donnée collectée pour l’instant (fallback seedé)');
    return 0;
  }

  for (const a of aggs) {
    // ── technology_metrics : champs couverts par le connecteur GitHub ──
    await fastify.pg.query(
      `UPDATE technology_metrics tm
          SET stars = $2,
              forks = $3,
              commits_monthly = CASE WHEN $4 > 0 THEN $4 ELSE tm.commits_monthly END,
              contributors    = CASE WHEN $5 > 0 THEN $5 ELSE tm.contributors END,
              updated_at = NOW()
        WHERE tm.technology_id = $1`,
      [a.technologyId, a.stars, a.forks, a.commits30d, a.contributors]
    );

    // NB : les sous-scores sont désormais calculés exclusivement par le cycle
    // connecteurs (workers/connectorsRefresh.ts) à partir de TOUS les signaux
    // réels — ce worker ne met à jour que les métriques GitHub brutes.
  }

  // Les lectures passent par deux caches : le snapshot taxonomie (mémoire,
  // 60 s) et les réponses analytiques (Redis `api:*`). On invalide les deux.
  fastify.taxonomy.invalidate();
  try {
    const keys = await fastify.redis.keys('api:*');
    if (keys.length > 0) await fastify.redis.del(...keys);
  } catch (err) {
    fastify.log.warn({ err }, 'Purge du cache api:* impossible (non bloquant)');
  }

  fastify.log.info({ technologies: aggs.length }, '📊 Métriques réelles réinjectées dans la taxonomie');
  return aggs.length;
}

const BOOT_DELAY_MS = 20_000; // laisse le temps à l'enregistrement + 1re collecte
const REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * Démarre le cycle : enregistrement des repos des technos comme projects,
 * puis rafraîchissement périodique des agrégats. Retourne un handle d'arrêt.
 */
export function startAggregatesRefresh(fastify: FastifyInstance): { stop: () => void } {
  let interval: ReturnType<typeof setInterval> | null = null;

  const boot = setTimeout(async () => {
    try {
      await ensureTechnologyProjects(fastify);
      await refreshTechnologyAggregates(fastify);
    } catch (err) {
      fastify.log.error({ err }, 'Cycle initial des agrégats réels en échec');
    }
    interval = setInterval(async () => {
      try {
        await ensureTechnologyProjects(fastify); // rattrape les repos manqués (quota…)
        await refreshTechnologyAggregates(fastify);
      } catch (err) {
        fastify.log.error({ err }, 'Rafraîchissement des agrégats réels en échec');
      }
    }, REFRESH_INTERVAL_MS);
  }, BOOT_DELAY_MS);

  return {
    stop: () => {
      clearTimeout(boot);
      if (interval) clearInterval(interval);
    },
  };
}
