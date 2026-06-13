import fp from 'fastify-plugin';
import { Pool } from 'pg';
import type { FastifyPluginAsync } from 'fastify';
import { getEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
  }
}

const pgPlugin: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  // Test connection
  try {
    const res = await pool.query('SELECT NOW() as now');
    fastify.log.info(`✅ PostgreSQL connected at ${res.rows[0].now}`);
  } catch (err) {
    fastify.log.error({ err }, '❌ PostgreSQL connection failed');
    throw err;
  }

  fastify.decorate('pg', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
};

export default fp(pgPlugin, { name: 'pg' });
