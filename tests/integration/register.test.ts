import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

const validBody = {
  owner_id: 'test-org',
  display_name: 'Test Org',
  domain: 'example.com',
  contact_email: 'admin@example.com',
  rap_url: 'https://example.com/agents.json',
  algorithm: 'ed25519' as const,
  public_key: 'TEST-PUBLIC-KEY-PEM',
  key_id: 'test-key-1',
};

describe('register routes (501 contract stage)', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  describe('POST /api/v1/register', () => {
    it('returns 501 with not_implemented for a valid body', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: validBody,
      });
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({
        error: 'not_implemented',
        endpoint: 'POST /api/v1/register',
      });
    });

    it('rejects with 400 when owner_id is missing', async () => {
      const { owner_id: _omit, ...bodyMissingOwnerId } = validBody;
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: bodyMissingOwnerId,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects with 400 when rap_url is not https', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register',
        payload: { ...validBody, rap_url: 'http://example.com/agents.json' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/register/:owner_id/verify', () => {
    it('returns 501 with not_implemented for a valid challenge body', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register/test-org/verify',
        payload: { challenge_signature: 'base64-signature-placeholder' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({
        error: 'not_implemented',
        endpoint: 'POST /api/v1/register/:owner_id/verify',
      });
    });

    it('rejects with 400 when challenge_signature is missing', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/register/test-org/verify',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
