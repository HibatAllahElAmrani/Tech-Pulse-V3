import fp from 'fastify-plugin';
import Redis from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';
import { getEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;       // generic / cache
    redisPub: Redis;    // publisher
    redisSub: Redis;    // subscriber
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();
  const opts = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,    // required for BullMQ
  };

  const redis = new Redis(opts);
  const redisPub = new Redis(opts);
  const redisSub = new Redis(opts);

  await Promise.all([
    new Promise<void>((res) => redis.once('ready', () => res())),
    new Promise<void>((res) => redisPub.once('ready', () => res())),
    new Promise<void>((res) => redisSub.once('ready', () => res())),
  ]);

  fastify.log.info('✅ Redis connected (cache + pub + sub)');

  fastify.decorate('redis', redis);
  fastify.decorate('redisPub', redisPub);
  fastify.decorate('redisSub', redisSub);

  fastify.addHook('onClose', async () => {
    await Promise.all([redis.quit(), redisPub.quit(), redisSub.quit()]);
  });
};

export default fp(redisPlugin, { name: 'redis' });
