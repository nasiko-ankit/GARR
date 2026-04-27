import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import { buildConfig } from './config/index.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerCors } from './plugins/cors.js';
import { registerDb } from './plugins/db.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerHealthRoute } from './routes/health.js';
import { registerRegisterRoutes } from './routes/register.js';
import { registerOwnersRoutes } from './routes/owners.js';
import { registerManifestRoute } from './routes/manifest.js';

export interface BuildServerOptions {
  logger?: boolean;
}

/**
 * Builds and configures the Fastify instance.
 * Exported so integration tests can call buildServer() without binding a port.
 */
export async function buildServer(options: BuildServerOptions = {}) {
  const config = buildConfig();

  const fastify = Fastify({
    logger:
      options.logger === false
        ? false
        : { level: config.nodeEnv === 'production' ? 'info' : 'debug' },
  });

  // Error handler first — wraps all subsequent plugin/route errors
  await registerErrorHandler(fastify);
  await registerCors(fastify);
  await registerDb(fastify);

  // Swagger must register before routes — schemas snapshot at route registration time
  await registerSwagger(fastify);

  // Routes
  await registerHealthRoute(fastify);
  await registerRegisterRoutes(fastify);
  await registerOwnersRoutes(fastify);
  await registerManifestRoute(fastify);

  return { fastify, config };
}

async function main(): Promise<void> {
  const { fastify, config } = await buildServer();

  // Graceful shutdown — fastify.close() drains connections via onClose hooks
  // (CLAUDE.md §461–468)
  const shutdown = async () => {
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

// Only run when this file is the direct entry point, not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
