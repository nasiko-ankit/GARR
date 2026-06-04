import { fileURLToPath } from 'node:url';
import Fastify           from 'fastify';
import cors              from '@fastify/cors';
import rateLimit         from '@fastify/rate-limit';
import { getConfig }     from './config.js';
import { closeDb }       from './db.js';
import { runMigrations } from './migrate.js';
import { registerHealthRoute  } from './routes/health.js';
import { registerCatalogRoute } from './routes/catalog.js';
import { registerAgentRoutes  } from './routes/agents.js';

export async function buildServer() {
  const cfg = getConfig();

  const app = Fastify({
    logger:      { level: cfg.nodeEnv === 'production' ? 'info' : 'debug' },
    trustProxy:  true,   // Required for correct req.ip behind nginx / cloud LB
    bodyLimit:   65536,  // 64 KB max body — rejects large payload attacks
  });

  // CORS — lock to known origins in production via CORS_ORIGINS env var
  await app.register(cors, {
    origin:  cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Rate limiting — per IP, 429 on breach
  await app.register(rateLimit, {
    max:        cfg.rateLimitMax,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error:  'rate_limited',
      detail: `Too many requests — limit is ${cfg.rateLimitMax}/min per IP. Try again in 60 seconds.`,
    }),
  });

  // Global error handler — never leak stack traces to callers
  app.setErrorHandler((err: { statusCode?: number; code?: string; message?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    app.log.error({ err, url: req.url, method: req.method }, 'request error');
    return reply.status(status).send({
      error:  status >= 500 ? 'internal_server_error' : (err.code ?? err.message ?? 'error'),
      detail: status < 500 ? err.message : undefined,
    });
  });

  // Routes
  await registerHealthRoute(app);
  await registerCatalogRoute(app);
  await registerAgentRoutes(app);

  // Drain DB pool on graceful shutdown
  app.addHook('onClose', async () => { await closeDb(); });

  return app;
}

async function main(): Promise<void> {
  const cfg = getConfig();

  // Run DB migrations before accepting traffic
  console.log('Running migrations...');
  await runMigrations();
  console.log('Migrations done.');

  const app = await buildServer();

  const shutdown = async () => {
    app.log.info('Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
}

// Only run when executed directly, not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
