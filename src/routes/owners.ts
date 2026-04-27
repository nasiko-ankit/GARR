import type { FastifyInstance } from 'fastify';
import { apiErrorSchema, ownerIdParamsSchema } from '../types/api/common.js';
import type { OwnerIdParams } from '../types/api/common.js';
import { entityOwnerWireSchema } from '../types/api/owners.js';

/**
 * Read path for one EntityOwner (CLAUDE.md §5.2).
 *
 *   GET /api/v1/owners/:owner_id  → 200 EntityOwnerWire
 *
 * v1 stage 1 returns 501. Real handler lands in Step 12+:
 *   bloom (deferred to v2) → cache (deferred to v2) → Postgres read replica
 */
export async function registerOwnersRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get<{ Params: OwnerIdParams }>(
    '/api/v1/owners/:owner_id',
    {
      schema: {
        params: ownerIdParamsSchema,
        response: {
          200: entityOwnerWireSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          501: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        endpoint: 'GET /api/v1/owners/:owner_id',
      });
    },
  );
}
