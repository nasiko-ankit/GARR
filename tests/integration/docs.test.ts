import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

describe('GET /docs/json — OpenAPI spec', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('serves a valid OpenAPI 3 document covering every registered route', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);

    const spec = res.json() as { openapi: string; info: { title: string }; paths: Record<string, unknown> };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('GARR');

    // Every endpoint stamped out in Step 9 must appear in the doc.
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/api/v1/register']).toBeDefined();
    expect(spec.paths['/api/v1/register/{owner_id}/verify']).toBeDefined();
    expect(spec.paths['/api/v1/owners/{owner_id}']).toBeDefined();
    expect(spec.paths['/global_agent_root.json']).toBeDefined();
  });
});
