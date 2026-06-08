import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db.js';

describe('Registry Server — auth routes', () => {
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
    await sql`DELETE FROM users WHERE email LIKE 'auth-test-%@example.com'`;
  });

  // ── POST /auth/register ───────────────────────────────────────────────────────

  it('POST /auth/register creates account and returns JWT', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'auth-test-1@example.com', password: 'securepassword1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  it('POST /auth/register returns 409 on duplicate email', async () => {
    const payload = { email: 'auth-test-dup@example.com', password: 'securepassword1' };
    await fastify.inject({ method: 'POST', url: '/auth/register', payload });
    const res = await fastify.inject({ method: 'POST', url: '/auth/register', payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('CONFLICT');
  });

  it('POST /auth/register returns 400 for short password', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'auth-test-short@example.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/register returns 400 for invalid email', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'securepassword1' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /auth/login ──────────────────────────────────────────────────────────

  it('POST /auth/login returns JWT for valid credentials', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'auth-test-login@example.com', password: 'correctpassword' },
    });

    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'auth-test-login@example.com', password: 'correctpassword' },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
  });

  it('POST /auth/login returns 401 for wrong password', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'auth-test-badpw@example.com', password: 'correctpassword' },
    });

    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'auth-test-badpw@example.com', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHORIZED');
  });

  it('POST /auth/login returns 401 for unknown email', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'auth-test-ghost@example.com', password: 'anypassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── GET /auth/me ──────────────────────────────────────────────────────────────

  it('GET /auth/me returns profile for valid JWT', async () => {
    const reg = await fastify.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'auth-test-me@example.com', password: 'securepassword1', display_name: 'Me User' },
    });
    const { token } = reg.json();

    const res = await fastify.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe('auth-test-me@example.com');
    expect(body.display_name).toBe('Me User');
    expect(typeof body.user_id).toBe('string');
  });

  it('GET /auth/me returns 401 without token', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
