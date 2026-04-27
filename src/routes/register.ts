import type { FastifyInstance } from 'fastify';
import { apiErrorSchema, ownerIdParamsSchema } from '../types/api/common.js';
import type { OwnerIdParams } from '../types/api/common.js';
import {
  registerRequestSchema,
  pendingChallengeResponseSchema,
  verifyChallengeRequestSchema,
  registeredOwnerResponseSchema,
} from '../types/api/register.js';
import type {
  RegisterRequest,
  VerifyChallengeRequest,
} from '../types/api/register.js';

/**
 * Registration flow (write path, CLAUDE.md §4 / §5.1).
 *
 *   POST /api/v1/register                       → 202 PendingChallenge
 *   POST /api/v1/register/:owner_id/verify      → 201 RegisteredOwner
 *
 * Both handlers return 501 in v1 stage 1. Real implementation lands in
 * Step 12 (DNS TXT + RAP HEAD verification → key challenge → signing).
 */
export async function registerRegisterRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post<{ Body: RegisterRequest }>(
    '/api/v1/register',
    {
      schema: {
        body: registerRequestSchema,
        response: {
          202: pendingChallengeResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          422: apiErrorSchema,
          501: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        endpoint: 'POST /api/v1/register',
      });
    },
  );

  fastify.post<{ Params: OwnerIdParams; Body: VerifyChallengeRequest }>(
    '/api/v1/register/:owner_id/verify',
    {
      schema: {
        params: ownerIdParamsSchema,
        body: verifyChallengeRequestSchema,
        response: {
          201: registeredOwnerResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
          501: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        endpoint: 'POST /api/v1/register/:owner_id/verify',
      });
    },
  );
}
