import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

async function seedOrg(orgId: string, domain: string, registryUrl: string): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status)
    VALUES
      (${orgId}, ${orgId}, ${domain}, ${`admin@${domain}`},
       ${registryUrl}, 'tok', true, 'active')
    ON CONFLICT (org_id) DO NOTHING
  `;
}

/** Minimal valid AgentRecord returned by a mock registry server. */
const MOCK_AGENT: Record<string, unknown> = {
  agent_id:     'ankit',
  display_name: 'Ankit Agent',
  description:  null,
  card_url:     'https://agents.nasiko.com/ankit/a2a.json',
  tags:         [],
  ttl_seconds:  3600,
  status:       'active',
  created_at:   '2026-01-01T00:00:00.000Z',
  updated_at:   '2026-01-01T00:00:00.000Z',
};

describe('GET /api/v1/resolve — 2-hop resolution', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'res-%'`;
  });

  it('resolves a locator and returns IndexRecord + AgentRecord', async () => {
    await seedOrg('res-nasiko', 'nasiko.com', 'https://registry.nasiko.com');

    // Mock the fetch call to the registry server
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_AGENT), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=ankit%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locator).toBe('ankit@nasiko.com:global');
    expect(body.index_record.org_id).toBe('res-nasiko');
    expect(body.index_record.registry_url).toBe('https://registry.nasiko.com');
    expect(body.agent_record.agent_id).toBe('ankit');
    expect(body.agent_record.card_url).toBe('https://agents.nasiko.com/ankit/a2a.json');
  });

  it('returns 404 when org is not in the index', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=agent%40unknown.example.com%3Aglobal',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 503 when registry server is unreachable', async () => {
    await seedOrg('res-down', 'down.example.com', 'https://down.example.com/registry');

    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=agent%40down.example.com%3Aglobal',
    });
    expect(res.statusCode).toBe(503);
  });

  it('returns 404 when agent is not found in registry', async () => {
    await seedOrg('res-404', '404.example.com', 'https://404.example.com/registry');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"NOT_FOUND"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=ghost%40404.example.com%3Aglobal',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when locator query param is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/resolve' });
    expect(res.statusCode).toBe(400);
  });
});
