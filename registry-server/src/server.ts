import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { getConfig } from './config.js';
import { closeSql } from './db.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAgentRoutes } from './routes/agents.js';

export interface BuildServerOptions {
  logger?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = getConfig();

  const fastify = Fastify({
    logger:
      options.logger === false
        ? false
        : { level: config.nodeEnv === 'production' ? 'info' : 'debug' },
  });

  await fastify.register(cors, { origin: true });

  fastify.setErrorHandler((error: { statusCode?: number; message?: string }, _request, reply) => {
    fastify.log.error(error);
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: error.message ?? 'INTERNAL_ERROR',
    });
  });

  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Registry Server',
        description: 'Self-hosted agent registry. Stores AgentRecords with card_url links to A2A cards.',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3002', description: 'local dev' }],
      tags: [
        { name: 'health', description: 'Liveness probe' },
        { name: 'agents', description: 'Agent record CRUD' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: true },
  });

  await registerHealthRoute(fastify);
  await registerAgentRoutes(fastify);

  return { fastify, config };
}

async function main(): Promise<void> {
  const { fastify, config } = await buildServer();

  const shutdown = async () => {
    await fastify.close();
    await closeSql();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
