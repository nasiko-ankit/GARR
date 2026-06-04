import type { FastifyInstance } from 'fastify';
import { getSql } from '../db.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    try {
      await getSql()`SELECT 1`;
      return reply.send({ status: 'ok', db: 'ok' });
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'unreachable' });
    }
  });
}
