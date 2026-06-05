import type { FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config.js';

/**
 * Admin API-key guard.
 *
 * Reads the key from the `Authorization: Bearer <key>` header.
 * Returns 401 when the header is missing or the key is wrong.
 * Never reveals the expected key value in the response.
 *
 * Apply as a `preHandler` on POST, PUT, and DELETE routes only.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const auth   = (request.headers['authorization'] ?? '') as string;
  const prefix = 'Bearer ';
  const key    = auth.startsWith(prefix) ? auth.slice(prefix.length).trim() : '';

  if (!key || key !== getConfig().adminApiKey) {
    await reply.status(401).send({
      error:  'unauthorized',
      detail: 'Valid admin API key required in Authorization: Bearer header',
    });
  }
}
