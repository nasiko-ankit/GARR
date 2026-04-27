import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

describe('GET /global_agent_root.json (501 contract stage)', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('returns 501 with not_implemented', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/global_agent_root.json',
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: 'not_implemented',
      endpoint: 'GET /global_agent_root.json',
    });
  });
});
