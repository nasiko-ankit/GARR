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
import type { EntityOwnerWire } from '../types/api/owners.js';
import type { EntityOwner } from '../types/entityOwner.js';
import { initiateRegistration, completeRegistration } from '../services/registration.js';

/** Converts the internal camelCase EntityOwner row to the snake_case wire shape. */
function toWire(owner: EntityOwner): EntityOwnerWire {
  return {
    owner_id: owner.ownerId,
    display_name: owner.displayName,
    domain: owner.domain,
    contact_email: owner.contactEmail,
    rap_url: owner.rapUrl,
    rap_fallback: owner.rapFallback,
    algorithm: owner.algorithm,
    public_key: owner.publicKey,
    key_id: owner.keyId,
    ttl_seconds: owner.ttlSeconds,
    serial: owner.serial,
    status: owner.status,
    issued_at: owner.issuedAt.toISOString(),
    expires_at: owner.expiresAt.toISOString(),
    signature_value: owner.signatureValue,
    signed_by: owner.signedBy,
  };
}

/**
 * Registration flow (write path, §4 / §5.1).
 *
 *   POST /api/v1/register                  → 202 PendingChallengeResponse
 *   POST /api/v1/register/:owner_id/verify → 201 EntityOwnerWire
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
        },
      },
    },
    async (request, reply) => {
      const result = await initiateRegistration(request.body, request.ip);
      if (!result.ok) {
        return reply.status(result.statusCode).send({
          error: result.error,
          detail: result.detail,
        });
      }
      return reply.status(202).send(result.value);
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
        },
      },
    },
    async (request, reply) => {
      const result = await completeRegistration(
        request.params.owner_id,
        request.body.challenge_signature,
        request.ip,
      );
      if (!result.ok) {
        return reply.status(result.statusCode).send({
          error: result.error,
          detail: result.detail,
        });
      }
      return reply.status(201).send(toWire(result.value));
    },
  );
}
