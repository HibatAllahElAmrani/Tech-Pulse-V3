import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { getEnv } from './config/env.js';
import pgPlugin from './plugins/pg.js';
import redisPlugin from './plugins/redis.js';
import socketioPlugin from './plugins/socketio.js';
import taxonomyPlugin from './plugins/taxonomy.js';
import healthRoutes from './routes/health.js';
import projectsRoutes from './routes/projects.js';
import catalogRoutes from './routes/catalog.js';
import analyticsRoutes from './routes/analytics.js';
import manageRoutes from './routes/manage.js';
import { createMetricsQueue, createMetricsWorker } from './workers/metricsWorker.js';
import { startScheduler } from './workers/scheduler.js';
import { startAggregatesRefresh } from './workers/aggregatesRefresh.js';
import { startConnectorsRefresh } from './workers/connectorsRefresh.js';

async function buildServer() {
  const env = getEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
  });

  // ---- Global plugins ----
  await app.register(helmet, {
    // API JSON pure : pas de CSP à imposer ici (le frontend a la sienne).
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // ---- Infrastructure plugins ----
  await app.register(pgPlugin);
  await app.register(redisPlugin);
  await app.register(socketioPlugin);
  await app.register(taxonomyPlugin);

  // ---- Workers ----
  const metricsQueue = createMetricsQueue();
  const metricsWorker = createMetricsWorker(app);
  startScheduler(app, metricsQueue);
  const aggregates = startAggregatesRefresh(app);
  const connectors = startConnectorsRefresh(app);

  app.addHook('onClose', async () => {
    aggregates.stop();
    connectors.stop();
    await metricsWorker.close();
    await metricsQueue.close();
  });

  // ---- Routes ----
  await app.register(healthRoutes);
  await app.register(
    async (fastify) => {
      await fastify.register(projectsRoutes, { metricsQueue });
      await fastify.register(catalogRoutes);
      await fastify.register(analyticsRoutes);
      await fastify.register(manageRoutes, { metricsQueue });
    },
    { prefix: '/api/v1' }
  );

  // ---- Root ----
  app.get('/', async () => ({
    name: 'OSS Pulse API',
    version: '0.2.0',
    docs: '/api/v1',
  }));

  return app;
}

async function start() {
  const env = getEnv();
  try {
    const app = await buildServer();
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`🚀 Backend running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
