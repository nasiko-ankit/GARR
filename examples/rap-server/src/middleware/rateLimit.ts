import type { FastifyInstance } from 'fastify';
import rateLimit               from '@fastify/rate-limit';
import { getConfig }           from '../config.js';

/**
 * Registers per-IP rate limiting on the Fastify instance.
 * Limit is configurable via RATE_LIMIT_MAX env var (default 120 req/min).
 * Returns 429 with a structured error envelope on breach.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  const cfg = getConfig();
  await app.register(rateLimit, {
    max:        cfg.rateLimitMax,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error:  'rate_limited',
      detail: `Too many requests — limit is ${cfg.rateLimitMax}/min per IP. Try again in 60 seconds.`,
    }),
  });
}
