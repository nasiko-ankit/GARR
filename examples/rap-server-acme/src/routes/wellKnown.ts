import { createPublicKey, sign } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';

/**
 * GET /.well-known/garr-public-key
 * Returns the public key for this RAP so the GARR register page can auto-fill it.
 *
 * POST /.well-known/garr-sign-challenge  (requires admin key)
 * Signs a GARR registration challenge nonce with this RAP's private key.
 * Allows the register page to complete challenge-response without a terminal.
 */
export async function registerWellKnownRoutes(app: FastifyInstance): Promise<void> {
  app.get('/.well-known/garr-public-key', async (_req, reply) => {
    const cfg = getConfig();
    const publicKey = createPublicKey(cfg.signingKey)
      .export({ type: 'spki', format: 'pem' }) as string;

    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send({
      public_key: publicKey.trim(),
      key_id:     cfg.signingKeyId,
      algorithm:  'ed25519',
    });
  });

  app.post('/.well-known/garr-sign-challenge', { preHandler: requireAdmin }, async (req, reply) => {
    const { nonce } = req.body as { nonce?: string };

    if (!nonce || !/^[0-9a-f]{64}$/.test(nonce)) {
      return reply.status(422).send({ error: 'invalid_nonce', detail: 'nonce must be a 64-char hex string' });
    }

    const cfg = getConfig();
    const signature = sign(null, Buffer.from(nonce, 'hex'), cfg.signingKey).toString('base64');

    return reply.send({ signature });
  });
}
