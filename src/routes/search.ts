// src/routes/search.ts
import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { searchQuerySchema, searchResponseSchema } from '../types/api/search.js';
import { searchEntityOwners } from '../db/queries/entityOwners.js';
import { toEntityOwnerWire } from '../lib/entityOwnerMapper.js';

interface SearchQuery {
  q: string;
}

/**
 * GET /api/v1/search?q=keyword
 *
 * Production behavior:
 * - validates query length
 * - performs a live DB search across owner_id, domain, display_name
 * - returns a stable, typed response envelope
 * - does not use Redis/Bloom filter; the spec marks this endpoint as
 *   non-cached
 */
export async function registerSearchRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get<{ Querystring: SearchQuery }>(
    '/api/v1/search',
    {
      config: { tags: ['search'] },
      schema: {
        querystring: searchQuerySchema,
        response: {
          200: searchResponseSchema,
          400: apiErrorSchema,
          422: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query.q.trim();

      if (query.length < 2) {
        return reply.status(422).send({
          error: 'validation_error',
          detail: 'q must contain at least 2 non-space characters',
          endpoint: 'GET /api/v1/search',
        });
      }

      const rows = await searchEntityOwners(fastify.db, query);
      const results = rows.map(toEntityOwnerWire);

      return reply.status(200).send({
        query,
        count: results.length,
        results,
      });
    },
  );
}