import type { FastifyInstance } from 'fastify';
import { apiErrorSchema, ownerIdParamsSchema } from '../types/api/common.js';
import type { OwnerIdParams } from '../types/api/common.js';
import { entityOwnerWireSchema } from '../types/api/owners.js';
import { getOwner } from '../services/owners.js';
import { toEntityOwnerWire } from '../services/ownerWire.js';

/**
 * Read path for one EntityOwner (§5.2).
 *
 *   GET /api/v1/owners/:owner_id  → 200 EntityOwnerWire | 404
 *
 * Never performs DNS or RAP checks — verification is write-time only.
 * TODO v2: bloom filter → Redis cache → Postgres read replica per §5.2/§6.2
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
        },
      },
    },
    async (request, reply) => {
      const owner = await getOwner(request.params.owner_id);
      if (!owner) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.status(200).send(toEntityOwnerWire(owner));
    },
  );
}
