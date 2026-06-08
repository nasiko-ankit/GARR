import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db.js';

const ADMIN_TOKEN = process.env['REGISTRY_ADMIN_TOKEN'] ?? 'test-token';
const AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };

describe('Agent CRUD routes', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM agents WHERE agent_id LIKE 'test-%'`;
  });

  // ── GET /agents ───────────────────────────────────────────────────────────────

  it('GET /agents returns 200 with catalog document shape', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('specVersion', '1.0');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  // ── /.well-known/ai-catalog.json ──────────────────────────────────────────────

  it('GET /.well-known/ai-catalog.json returns catalog document', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/.well-known/ai-catalog.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/ai-catalog+json');
    const body = res.json();
    expect(body).toHaveProperty('specVersion', '1.0');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  // ── POST /agents ──────────────────────────────────────────────────────────────

  it('POST /agents returns 401 without token', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      payload: { agent_id: 'test-anon', display_name: 'Anon', url: 'https://example.com/card' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /agents creates an agent and returns 201 with CatalogEntry', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      headers: AUTH,
      payload: {
        agent_id: 'test-create',
        display_name: 'Test Agent',
        url: 'https://example.com/a2a.json',
        tags: ['search'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.identifier).toBe('test-create');
    expect(body.displayName).toBe('Test Agent');
    expect(body.url).toBe('https://example.com/a2a.json');
    expect(body.tags).toEqual(['search']);
    expect(body.mediaType).toBeDefined();
    expect(body.metadata?.status).toBe('active');
  });

  it('POST /agents returns 409 on duplicate agent_id', async () => {
    const payload = { agent_id: 'test-dup', display_name: 'Dup', url: 'https://example.com/c' };
    await fastify.inject({ method: 'POST', url: '/agents', headers: AUTH, payload });
    const res = await fastify.inject({ method: 'POST', url: '/agents', headers: AUTH, payload });
    expect(res.statusCode).toBe(409);
  });

  it('POST /agents returns 400 on invalid agent_id (uppercase)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      headers: AUTH,
      payload: { agent_id: 'Test-UPPER', display_name: 'Bad', url: 'https://example.com/c' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /agents/:agent_id ─────────────────────────────────────────────────────

  it('GET /agents/:agent_id returns CatalogEntry', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-get', display_name: 'Get Me', url: 'https://example.com/get' },
    });

    const res = await fastify.inject({ method: 'GET', url: '/agents/test-get' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identifier).toBe('test-get');
    expect(body.displayName).toBe('Get Me');
    expect(body.url).toBe('https://example.com/get');
  });

  it('GET /agents/:agent_id returns 404 for missing agent', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/test-notfound' });
    expect(res.statusCode).toBe(404);
  });

  // ── PUT /agents/:agent_id ─────────────────────────────────────────────────────

  it('PUT /agents/:agent_id updates fields', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-update', display_name: 'Old Name', url: 'https://example.com/old' },
    });

    const res = await fastify.inject({
      method: 'PUT', url: '/agents/test-update', headers: AUTH,
      payload: { display_name: 'New Name', url: 'https://example.com/new' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe('New Name');
    expect(res.json().url).toBe('https://example.com/new');
  });

  it('PUT /agents/:agent_id returns 401 without token', async () => {
    const res = await fastify.inject({
      method: 'PUT', url: '/agents/test-update',
      payload: { display_name: 'Hacked' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── DELETE /agents/:agent_id ──────────────────────────────────────────────────

  it('DELETE /agents/:agent_id removes the agent', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-del', display_name: 'Del Me', url: 'https://example.com/del' },
    });

    const del = await fastify.inject({ method: 'DELETE', url: '/agents/test-del', headers: AUTH });
    expect(del.statusCode).toBe(204);

    const get = await fastify.inject({ method: 'GET', url: '/agents/test-del' });
    expect(get.statusCode).toBe(404);
  });

  it('DELETE /agents/:agent_id returns 401 without token', async () => {
    const res = await fastify.inject({ method: 'DELETE', url: '/agents/test-del' });
    expect(res.statusCode).toBe(401);
  });
});
