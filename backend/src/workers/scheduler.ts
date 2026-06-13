import type { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { CollectJobData } from './metricsWorker.js';
import { getEnv } from '../config/env.js';

/**
 * Periodically enqueues collection jobs based on priority tiers,
 * matching the cahier des charges spec:
 *   HIGH:   stars/issues   → every 30s
 *   MEDIUM: commits/PRs    → every 5min
 *   LOW:    contributors   → every 15min
 *
 * For MVP simplicity, we use a single job that fetches everything,
 * with the `priority` field controlling whether to refresh contributors/commits.
 */
export function startScheduler(
  fastify: FastifyInstance,
  queue: Queue<CollectJobData>
) {
  // Sans token GitHub, le quota anonyme est de 60 req/h : on espace
  // drastiquement la collecte pour rester dessous au lieu de brûler le quota
  // en quelques minutes (et bloquer aussi l'enregistrement des repos).
  const env = getEnv();
  const authenticated = Boolean(
    (env.GITHUB_TOKENS ?? '').trim() || (env.GITHUB_PERSONAL_TOKEN ?? '').trim()
  );
  if (!authenticated) {
    fastify.log.warn(
      '⚠️  Aucun token GitHub (GITHUB_TOKENS / GITHUB_PERSONAL_TOKEN) — collecte ralentie (quota anonyme 60 req/h). Ajoutez un token dans .env.docker pour une collecte temps réel.'
    );
  }
  const HIGH_INTERVAL = authenticated ? 30_000 : 60 * 60_000;        // 30s | 1h
  const MEDIUM_INTERVAL = authenticated ? 5 * 60_000 : 3 * 3600_000; // 5min | 3h
  const LOW_INTERVAL = authenticated ? 15 * 60_000 : 6 * 3600_000;   // 15min | 6h

  async function enqueueAll(priority: 'high' | 'medium' | 'low') {
    const { rows } = await fastify.pg.query<{
      id: string;
      owner: string;
      repo: string;
    }>(`SELECT id, owner, repo FROM projects WHERE is_archived = FALSE LIMIT 100`);

    if (rows.length === 0) return;

    fastify.log.debug(
      `📅 Scheduler enqueuing ${rows.length} ${priority}-priority jobs`
    );

    await Promise.all(
      rows.map((row) =>
        queue.add(
          `collect:${priority}:${row.id}`,
          { projectId: row.id, owner: row.owner, repo: row.repo, priority },
          {
            jobId: `${priority}:${row.id}:${Date.now()}`,
            priority: priority === 'high' ? 1 : priority === 'medium' ? 2 : 3,
          }
        )
      )
    );
  }

  const handles = [
    setInterval(() => enqueueAll('high').catch((err) => fastify.log.error({ err }, 'High scheduler failed')), HIGH_INTERVAL),
    setInterval(() => enqueueAll('medium').catch((err) => fastify.log.error({ err }, 'Medium scheduler failed')), MEDIUM_INTERVAL),
    setInterval(() => enqueueAll('low').catch((err) => fastify.log.error({ err }, 'Low scheduler failed')), LOW_INTERVAL),
    // Passe complète (snapshot + contributeurs + heatmap commits) peu après le
    // démarrage : les agrégations réelles ont des données dès la 1re minute au
    // lieu d'attendre le 1er tick "low".
    setTimeout(
      () => enqueueAll('low').catch((err) => fastify.log.error({ err }, 'Initial low pass failed')),
      45_000
    ),
  ];

  fastify.log.info(
    `📅 Scheduler started (high=${HIGH_INTERVAL / 1000}s, medium=${MEDIUM_INTERVAL / 60_000}min, low=${LOW_INTERVAL / 60_000}min, github=${authenticated ? 'token' : 'anonyme'})`
  );

  fastify.addHook('onClose', async () => {
    handles.forEach((h) => clearInterval(h));
  });
}
