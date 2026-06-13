import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/health/ready', async (_request, reply) => {
    try {
      await fastify.pg.query('SELECT 1');
      const pong = await fastify.redis.ping();
      if (pong !== 'PONG') throw new Error('Redis ping failed');
      return { status: 'ready', postgres: 'ok', redis: 'ok' };
    } catch (err) {
      reply.code(503);
      return {
        status: 'not_ready',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
};

export default healthRoutes;
