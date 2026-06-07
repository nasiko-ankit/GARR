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

  // ── GET /agents ──────────────────────────────────────────────────────────────

  it('GET /agents returns 200 with empty array when no agents', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  // ── POST /agents ─────────────────────────────────────────────────────────────

  it('POST /agents returns 401 without token', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      payload: { agent_id: 'test-anon', display_name: 'Anon', card_url: 'https://example.com/card' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /agents creates an agent and returns 201', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      headers: AUTH,
      payload: {
        agent_id: 'test-create',
        display_name: 'Test Agent',
        card_url: 'https://example.com/a2a.json',
        tags: ['search'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.agent_id).toBe('test-create');
    expect(body.card_url).toBe('https://example.com/a2a.json');
    expect(body.tags).toEqual(['search']);
    expect(body.status).toBe('active');
  });

  it('POST /agents returns 409 on duplicate agent_id', async () => {
    const payload = { agent_id: 'test-dup', display_name: 'Dup', card_url: 'https://example.com/c' };
    await fastify.inject({ method: 'POST', url: '/agents', headers: AUTH, payload });
    const res = await fastify.inject({ method: 'POST', url: '/agents', headers: AUTH, payload });
    expect(res.statusCode).toBe(409);
  });

  it('POST /agents returns 400 on invalid agent_id (uppercase)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agents',
      headers: AUTH,
      payload: { agent_id: 'Test-UPPER', display_name: 'Bad', card_url: 'https://example.com/c' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /agents/:agent_id ─────────────────────────────────────────────────

  it('GET /agents/:agent_id returns the agent', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-get', display_name: 'Get Me', card_url: 'https://example.com/get' },
    });

    const res = await fastify.inject({ method: 'GET', url: '/agents/test-get' });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent_id).toBe('test-get');
  });

  it('GET /agents/:agent_id returns 404 for missing agent', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents/test-notfound' });
    expect(res.statusCode).toBe(404);
  });

  // ── PUT /agents/:agent_id ─────────────────────────────────────────────────

  it('PUT /agents/:agent_id updates fields', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-update', display_name: 'Old Name', card_url: 'https://example.com/old' },
    });

    const res = await fastify.inject({
      method: 'PUT', url: '/agents/test-update', headers: AUTH,
      payload: { display_name: 'New Name', card_url: 'https://example.com/new' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('New Name');
    expect(res.json().card_url).toBe('https://example.com/new');
  });

  it('PUT /agents/:agent_id returns 401 without token', async () => {
    const res = await fastify.inject({
      method: 'PUT', url: '/agents/test-update',
      payload: { display_name: 'Hacked' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── DELETE /agents/:agent_id ──────────────────────────────────────────────

  it('DELETE /agents/:agent_id removes the agent', async () => {
    await fastify.inject({
      method: 'POST', url: '/agents', headers: AUTH,
      payload: { agent_id: 'test-del', display_name: 'Del Me', card_url: 'https://example.com/del' },
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
