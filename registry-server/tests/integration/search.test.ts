import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db.js';

const ADMIN_TOKEN = process.env['REGISTRY_ADMIN_TOKEN'] ?? 'test-token';
const AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };

describe('GET /agents/search', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    // Seed test agents
    const sql = getSql();
    await sql`DELETE FROM agents WHERE agent_id LIKE 'srch-%'`;
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'srch-weather', display_name: 'Weather Agent', url: 'https://example.com/weather', tags: ['weather', 'forecast'] },
    });
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'srch-order', display_name: 'Order Tracker', url: 'https://example.com/order', tags: ['ecommerce'] },
    });
  });

  afterAll(async () => {
    const sql = getSql();
    await sql`DELETE FROM agents WHERE agent_id LIKE 'srch-%'`;
    await fastify.close();
    const { closeSql } = await import('../../src/db.js');
    await closeSql();
  });

  beforeEach(async () => {
    // no per-test cleanup needed — seed is stable
  });

  it('keyword search returns matching agents', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/search?q=weather' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.specVersion).toBe('1.0');
    expect(body.entries.some((e: { identifier: string }) => e.identifier === 'srch-weather')).toBe(true);
    expect(body.entries.every((e: { identifier: string }) => e.identifier !== 'srch-order')).toBe(true);
  });

  it('keyword search matches tags', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/search?q=ecommerce' });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.some((e: { identifier: string }) => e.identifier === 'srch-order')).toBe(true);
  });

  it('URN fast-path returns exact agent by identifier', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/search?q=urn:ai:moonbakery.com:srch-order' });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].identifier).toBe('srch-order');
  });

  it('returns empty entries for no match', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/search?q=zzz-no-match-xyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });

  it('returns 400 when q is blank', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/search?q= ' });
    expect(res.statusCode).toBe(400);
  });
});
