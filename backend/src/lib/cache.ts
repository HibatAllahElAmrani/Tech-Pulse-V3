import type { FastifyInstance } from 'fastify';

/**
 * Cache JSON Redis pour les endpoints analytiques.
 *
 * Les générateurs sont déterministes, donc le cache est trivialement correct ;
 * il évite surtout de recalculer les agrégats géo (15 technos × 24 pays) à
 * chaque requête. En cas d'indisponibilité Redis, on dégrade en calcul direct
 * (jamais d'erreur 500 à cause du cache).
 */
export async function cachedJson<T>(
  fastify: FastifyInstance,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>
): Promise<T> {
  const cacheKey = `api:${key}`;
  try {
    const hit = await fastify.redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as T;
  } catch (err) {
    fastify.log.warn({ err, key: cacheKey }, 'Redis cache read failed — computing directly');
  }

  const value = await producer();

  try {
    await fastify.redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    fastify.log.warn({ err, key: cacheKey }, 'Redis cache write failed (non-blocking)');
  }
  return value;
}
