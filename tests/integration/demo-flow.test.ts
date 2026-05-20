/**
 * End-to-end test of the cross-registry demo flow.
 *
 *   parseLocator → /mock/nanda/lookup → fetch /mock/registries/.../cards/...
 *                                     → AgentCard
 *   POST /mock/agents/walmart-demo/invoke with caller=Google → handshake_ok
 *
 * Requires the seed JSONs in db/seed/. The whole suite is skipped when
 * those files are absent so a fresh clone without seeds doesn't break CI.
 *
 * Unlike other integration tests we listen on a real port — the resolver
 * issues a live HTTP fetch to NANDA_INDEX_BASE_URL, which can't be served
 * by fastify.inject().
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ResolveResponse, AgentCard, IndexRecord } from '../../src/types/api/resolve.js';

// Pin a test-only port + override NANDA base URL BEFORE the buildServer
// import below. nandaIndexClient caches the override at module load.
const { TEST_PORT } = vi.hoisted(() => {
  const port = 3555;
  process.env.NANDA_INDEX_BASE_URL = `http://127.0.0.1:${port}/mock/nanda`;
  return { TEST_PORT: port };
});

const { buildServer } = await import('../../src/server.js');

const SEED_DIR = path.resolve(process.cwd(), 'db/seed');
const GOOGLE_SEED = path.join(SEED_DIR, 'google.json');
const WALMART_SEED = path.join(SEED_DIR, 'walmart.json');
const SEEDS_PRESENT = existsSync(GOOGLE_SEED) && existsSync(WALMART_SEED);

interface SeedAgent {
  agent_id: string;
  index_record: IndexRecord;
  agent_card: AgentCard;
}
interface SeedFile {
  slug: string;
  owner_id: string;
  agents: SeedAgent[];
}

function loadSeed(file: string): SeedFile {
  return JSON.parse(readFileSync(file, 'utf8')) as SeedFile;
}

describe.skipIf(!SEEDS_PRESENT)('cross-registry demo flow', () => {
  let fastify: FastifyInstance;
  let google: SeedFile;
  let walmart: SeedFile;

  beforeAll(async () => {
    google = loadSeed(GOOGLE_SEED);
    walmart = loadSeed(WALMART_SEED);

    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
    await fastify.listen({ port: TEST_PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  it('resolves a Walmart agent end-to-end via the mock NANDA + registry chain', async () => {
    const target = walmart.agents.find((a) => a.agent_id.startsWith('order-status@'));
    if (!target) throw new Error('seed missing order-status agent');

    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/api/v1/resolve?locator=${encodeURIComponent(target.agent_id)}:global`,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as ResolveResponse;
    expect(body.resolution_mode).toBe('global');
    expect(body.resolved_via).toBe('nandaindex.org');
    expect(body.index_record.agent_id).toBe(target.agent_id);
    expect(body.index_record.card_url).toBe(target.index_record.card_url);
    expect(body.agent_card.id).toBe(target.agent_id);
    expect(body.agent_card.invocation_url).toBe(target.agent_card.invocation_url);
    expect(body.agent_card.capabilities).toEqual(target.agent_card.capabilities);
  });

  it('handles a Google→Walmart A2A handshake', async () => {
    const caller = google.agents.find((a) => a.agent_id.startsWith('search-bot@'));
    const callee = walmart.agents.find((a) => a.agent_id.startsWith('order-status@'));
    if (!caller || !callee) throw new Error('seed missing required agents');

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mock/agents/walmart-demo/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_card: caller.agent_card,
        callee_agent_id: callee.agent_id,
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      handshake_ok: boolean;
      callee_card: AgentCard;
      echoed_caller_id: string;
      at: string;
    };
    expect(body.handshake_ok).toBe(true);
    expect(body.echoed_caller_id).toBe(caller.agent_card.id);
    expect(body.callee_card.id).toBe(callee.agent_id);
    expect(new Date(body.at).getTime()).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown callee on the invoke endpoint', async () => {
    const caller = google.agents[0]!;
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mock/agents/walmart-demo/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_card: caller.agent_card,
        callee_agent_id: 'no-such-agent@walmart-demo.local',
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});