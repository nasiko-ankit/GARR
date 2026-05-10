import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { searchQuerySchema, searchResponseSchema } from '../types/api/search.js';
import { searchOwners } from '../services/search.js';

interface SearchQuerystring {
  q: string;
}

/**
 * Keyword search across owner_id, domain, and display_name (§5.2 read path).
 *
 *   GET /api/v1/search?q=keyword  → 200 SearchResponse
 *
 * Live DB query — not cached (no Redis layer in v1).
 * TODO v2: add Redis cache layer per §6.2
 */
export async function registerSearchRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get<{ Querystring: SearchQuerystring }>(
    '/api/v1/search',
    {
      schema: {
        querystring: searchQuerySchema,
        response: {
          200: searchResponseSchema,
          400: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query.q.trim();

      if (query.length < 2) {
        return reply.status(422).send({
          error: 'query_too_short',
          detail: 'q must be at least 2 non-space characters',
        });
      }

      const result = await searchOwners(query);
      return reply.status(200).send(result);
    },
  );
}
