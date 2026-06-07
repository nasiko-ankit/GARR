import type { FastifyInstance } from 'fastify';
import { getSql } from '../db.js';

export async function registerHealthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          required: ['status', 'db'],
          properties: {
            status: { type: 'string', const: 'ok' },
            db:     { type: 'string', const: 'ok' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const sql = getSql();
    await sql`SELECT 1`;
    return reply.send({ status: 'ok', db: 'ok' });
  });
}
