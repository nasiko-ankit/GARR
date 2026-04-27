import type { FastifyInstance } from 'fastify';

/**
 * CORS placeholder for v1. All origins allowed; restrict to an allow-list
 * in v2 when the client origin is known.
 */
export async function registerCors(_fastify: FastifyInstance): Promise<void> {
  // TODO v2: configure per-environment CORS allow-list
}
