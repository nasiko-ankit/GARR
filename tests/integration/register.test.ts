import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  createPrivateKey,
} from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Mock external I/O before importing anything that triggers module loading.
// Vitest hoists vi.mock() calls so the server sees the mocked modules.
vi.mock('../../src/lib/dnsVerification.js', () => ({
  verifyDmarcTxt: vi.fn().mockResolvedValue('v=DMARC1; p=reject'),
}));
vi.mock('../../src/lib/rapVerification.js', () => ({
  headRap: vi.fn().mockResolvedValue(undefined),
}));

import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

// Test keypair — ed25519, generated once per suite run
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TEST_OWNER_ID = 'test-reg-org';
const TEST_DOMAIN = 'test-reg.example.com';

const validBody = {
  owner_id: TEST_OWNER_ID,
  display_name: 'Test Reg Org',
  domain: TEST_DOMAIN,
  contact_email: 'admin@test-reg.example.com',
  rap_url: 'https://test-reg.example.com/agents.json',
  algorithm: 'ed25519' as const,
  public_key: publicKey,
  key_id: 'test-key-1',
};

/** Signs the nonce with our test private key (same algorithm the service uses to verify). */
function signNonce(nonce: string): string {
  const key = createPrivateKey(privateKey);
  return cryptoSign(null, Buffer.from(nonce, 'utf8'), key).toString('base64');
}

describe('register routes', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    // Close the db client so Vitest can exit cleanly
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  afterEach(async () => {
    // Clean up test rows so tests are independent
    const sql = getSql();
    await sql`DELETE FROM audit_log            WHERE owner_id = ${TEST_OWNER_ID}`;
    await sql`DELETE FROM entity_owners        WHERE owner_id = ${TEST_OWNER_ID}`;
    await sql`DELETE FROM pending_registrations WHERE owner_id = ${TEST_OWNER_ID}`;
  });

  // ─── Schema validation (unchanged from 501 stage) ────────────────────────

  describe('POST /api/v1/register — schema guards', () => {
    it('rejects 400 when owner_id is missing', async () => {
      const { owner_id: _omit, ...body } = validBody;
      const res = await fastify.inject({ method: 'POST', url: '/api/v1/register', payload: body });
      expect(res.statusCode).toBe(400);
    });

    it('rejects 400 when rap_url is not https', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: { ...validBody, rap_url: 'http://test-reg.example.com/agents.json' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/register/:owner_id/verify — schema guards', () => {
    it('rejects 400 when challenge_signature is missing', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Initiation happy path ────────────────────────────────────────────────

  describe('POST /api/v1/register', () => {
    it('returns 202 with challenge nonce on valid body', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(res.statusCode).toBe(202);

      const body = res.json();
      expect(body.owner_id).toBe(TEST_OWNER_ID);
      expect(body.challenge_nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(body.next_step).toBe(`/api/v1/register/${TEST_OWNER_ID}/verify`);
      expect(new Date(body.challenge_expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns 409 when owner_id is already registered', async () => {
      // Complete a registration first
      const initRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      const nonce = initRes.json<{ challenge_nonce: string }>().challenge_nonce;

      await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: { challenge_signature: signNonce(nonce) },
      });

      // Second registration attempt for the same owner_id
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('conflict');
    });

    it('returns 409 when domain is already registered under a different owner_id', async () => {
      // Register successfully first
      const initRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      const nonce = initRes.json<{ challenge_nonce: string }>().challenge_nonce;
      await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: { challenge_signature: signNonce(nonce) },
      });

      // Different owner_id, same domain
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: { ...validBody, owner_id: 'test-reg-org-2' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('conflict');
    });

    it('returns 422 when DMARC verification fails', async () => {
      const { verifyDmarcTxt } = await import('../../src/lib/dnsVerification.js');
      vi.mocked(verifyDmarcTxt).mockRejectedValueOnce(
        new Error('DMARC TXT lookup failed for _dmarc.test-reg.example.com: ENOTFOUND'),
      );

      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('dmarc_verification_failed');
    });

    it('returns 422 when RAP endpoint is unreachable', async () => {
      const { headRap } = await import('../../src/lib/rapVerification.js');
      vi.mocked(headRap).mockRejectedValueOnce(
        new Error('RAP reachability check failed for https://test-reg.example.com/agents.json: ECONNREFUSED'),
      );

      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('rap_unreachable');
    });
  });

  // ─── Verify happy path ────────────────────────────────────────────────────

  describe('POST /api/v1/register/:owner_id/verify', () => {
    it('returns 201 with signed EntityOwner on valid signature', async () => {
      const initRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(initRes.statusCode).toBe(202);
      const { challenge_nonce } = initRes.json<{ challenge_nonce: string }>();

      const verifyRes = await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: { challenge_signature: signNonce(challenge_nonce) },
      });
      expect(verifyRes.statusCode).toBe(201);

      const owner = verifyRes.json();
      expect(owner.owner_id).toBe(TEST_OWNER_ID);
      expect(owner.domain).toBe(TEST_DOMAIN);
      expect(owner.status).toBe('active');
      expect(owner.serial).toMatch(/^\d{10}$/);
      expect(owner.signature_value).toBeTruthy();
      expect(owner.signed_by).toBeTruthy();
      expect(owner.issued_at).toBeTruthy();
      expect(owner.expires_at).toBeTruthy();
    });

    it('returns 404 when no pending registration exists for owner_id', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: { challenge_signature: 'dGVzdA==' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 422 when challenge_signature is invalid', async () => {
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });

      const res = await fastify.inject({
        method: 'POST',
        url: `/api/v1/register/${TEST_OWNER_ID}/verify`,
        payload: { challenge_signature: 'aW52YWxpZHNpZ25hdHVyZQ==' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('signature_invalid');
    });
  });

  // ─── Full round-trip ─────────────────────────────────────────────────────

  it('full round-trip: register → verify → 201 with valid signed record', async () => {
    const initRes = await fastify.inject({
      method: 'POST',
      url: '/api/v1/register',
      payload: validBody,
    });
    expect(initRes.statusCode).toBe(202);

    const { challenge_nonce, next_step } = initRes.json<{
      challenge_nonce: string;
      next_step: string;
    }>();
    expect(next_step).toBe(`/api/v1/register/${TEST_OWNER_ID}/verify`);

    const verifyRes = await fastify.inject({
      method: 'POST',
      url: next_step,
      payload: { challenge_signature: signNonce(challenge_nonce) },
    });
    expect(verifyRes.statusCode).toBe(201);

    const owner = verifyRes.json();
    expect(owner.owner_id).toBe(TEST_OWNER_ID);
    expect(owner.public_key).toBe(publicKey);
    expect(owner.algorithm).toBe('ed25519');
    expect(owner.status).toBe('active');

    // Verify the GARR root signature over the returned record is valid
    const { verifyCanonical } = await import('../../src/services/signing.js');
    const { buildConfig } = await import('../../src/config/index.js');
    const config = buildConfig();
    const { publicKey: rootPubPem } = generateKeyPairSync('ed25519', {
      // We can't re-derive the root public key in tests, but we can verify
      // the signature using the root private key's derived public key.
      // Instead: just confirm the fields are non-empty and well-formed.
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    // Confirm verifyCanonical returns false for a wrong key (tamper detection)
    expect(verifyCanonical(owner, owner.signature_value, rootPubPem, 'ed25519')).toBe(false);
    // Confirm verifyCanonical returns true using the actual signing key
    const { createPublicKey } = await import('node:crypto');
    const realRootPub = createPublicKey(config.signing.privateKey).export({
      type: 'spki',
      format: 'pem',
    }) as string;
    expect(verifyCanonical(owner, owner.signature_value, realRootPub, 'ed25519')).toBe(true);
  });
});
