import fp from 'fastify-plugin';
import { Server as SocketIOServer } from 'socket.io';
import type { FastifyPluginAsync } from 'fastify';
import { getEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

const socketioPlugin: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();

  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
    path: '/ws',
    transports: ['websocket', 'polling'],  // SSE-like fallback
  });

  // Subscribe to Redis pub/sub for project metric updates
  fastify.redisSub.psubscribe('project:*:update', (err) => {
    if (err) {
      fastify.log.error({ err }, 'Failed to subscribe to Redis channels');
    } else {
      fastify.log.info('✅ Subscribed to Redis pub/sub: project:*:update');
    }
  });

  fastify.redisSub.on('pmessage', (_pattern, channel, message) => {
    // channel format: project:{uuid}:update
    const projectId = channel.split(':')[1];
    if (!projectId) return;
    try {
      const data = JSON.parse(message);
      io.to(`project:${projectId}`).emit('metrics:update', data);
    } catch (err) {
      fastify.log.error({ err, channel }, 'Failed to parse pub/sub message');
    }
  });

  // Connection handling
  io.on('connection', (socket) => {
    fastify.log.info({ socketId: socket.id }, '🔌 Client connected');

    socket.on('subscribe:project', (projectId: string) => {
      socket.join(`project:${projectId}`);
      fastify.log.debug({ socketId: socket.id, projectId }, 'Subscribed to project');
    });

    socket.on('unsubscribe:project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on('disconnect', () => {
      fastify.log.info({ socketId: socket.id }, '🔌 Client disconnected');
    });
  });

  fastify.decorate('io', io);

  fastify.addHook('onClose', async () => {
    io.close();
  });
};

export default fp(socketioPlugin, {
  name: 'socketio',
  dependencies: ['redis'],
});
