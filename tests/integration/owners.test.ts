import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

describe('GET /api/v1/owners/:owner_id (501 contract stage)', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('returns 501 with not_implemented for a valid owner_id', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/owners/test-org',
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: 'not_implemented',
      endpoint: 'GET /api/v1/owners/:owner_id',
    });
  });

  it('rejects with 400 when owner_id contains uppercase', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/owners/Test-Org',
    });
    expect(res.statusCode).toBe(400);
  });
});
