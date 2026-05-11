import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IndexRecord, AgentCard, ResolveResponse } from '../../src/types/api/resolve.js';

// Mock all external I/O libs before the server loads them.
// Vitest hoists vi.mock() to the top of the module.
vi.mock('../../src/lib/nandaIndexClient.js', () => ({
  lookupNandaIndex: vi.fn(),
  NandaIndexError: class NandaIndexError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
      this.name = 'NandaIndexError';
    }
  },
}));

vi.mock('../../src/lib/dnsSrvResolver.js', () => ({
  lookupViaDnsSrv: vi.fn(),
  DnsSrvError: class DnsSrvError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
      this.name = 'DnsSrvError';
    }
  },
}));

vi.mock('../../src/lib/agentCardFetcher.js', () => ({
  fetchAgentCard: vi.fn(),
  AgentCardError: class AgentCardError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
      this.name = 'AgentCardError';
    }
  },
}));

import { buildServer } from '../../src/server.js';
import { lookupNandaIndex } from '../../src/lib/nandaIndexClient.js';
import { lookupViaDnsSrv } from '../../src/lib/dnsSrvResolver.js';
import { fetchAgentCard } from '../../src/lib/agentCardFetcher.js';
import { NandaIndexError } from '../../src/lib/nandaIndexClient.js';
import { DnsSrvError } from '../../src/lib/dnsSrvResolver.js';
import { AgentCardError } from '../../src/lib/agentCardFetcher.js';

const mockLookupNandaIndex = vi.mocked(lookupNandaIndex);
const mockLookupViaDnsSrv  = vi.mocked(lookupViaDnsSrv);
const mockFetchAgentCard   = vi.mocked(fetchAgentCard);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_INDEX_RECORD: IndexRecord = {
  agent_id:   'scheduler@nasiko.com',
  agent_name: 'Scheduler Agent',
  card_url:   'https://nasiko.com/agents/scheduler.json',
  ttl:        3600,
  signature:  'dGVzdC1zaWduYXR1cmU=',
};

const TEST_AGENT_CARD: AgentCard = {
  id:             'scheduler@nasiko.com',
  display_name:   'Scheduler Agent',
  description:    'Schedules meetings and tasks.',
  capabilities:   ['schedule', 'remind'],
  invocation_url: 'https://nasiko.com/invoke/scheduler',
  protocol:       'https',
  visibility:     'public',
  signature:      'dGVzdC1jYXJkLXNpZw==',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/resolve', () => {
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

  // ── Happy paths ──────────────────────────────────────────────────────────────

  it(':global mode — resolves via NANDA Index and returns 200', async () => {
    mockLookupNandaIndex.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockResolvedValueOnce(TEST_AGENT_CARD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ResolveResponse>();
    expect(body.locator).toBe('scheduler@nasiko.com:global');
    expect(body.resolution_mode).toBe('global');
    expect(body.resolved_via).toBe('nandaindex.org');
    expect(body.index_record.agent_id).toBe('scheduler@nasiko.com');
    expect(body.agent_card.id).toBe('scheduler@nasiko.com');
    expect(mockLookupNandaIndex).toHaveBeenCalledWith('scheduler@nasiko.com');
    expect(mockFetchAgentCard).toHaveBeenCalledWith(TEST_INDEX_RECORD.card_url);
  });

  it(':nandaindex.org mode — resolves via named NANDA Index and returns 200', async () => {
    mockLookupNandaIndex.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockResolvedValueOnce(TEST_AGENT_CARD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Anandaindex.org',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ResolveResponse>();
    expect(body.resolution_mode).toBe('nandaindex.org');
    expect(body.resolved_via).toBe('nandaindex.org');
    expect(mockLookupNandaIndex).toHaveBeenCalledWith('scheduler@nasiko.com', 'nandaindex.org');
  });

  it(':dnssrv mode — resolves via DNS SRV and returns 200', async () => {
    mockLookupViaDnsSrv.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockResolvedValueOnce(TEST_AGENT_CARD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Adnssrv',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ResolveResponse>();
    expect(body.resolution_mode).toBe('dnssrv');
    expect(body.resolved_via).toBe('dns-srv:nasiko.com');
    expect(mockLookupViaDnsSrv).toHaveBeenCalledWith('scheduler@nasiko.com', 'nasiko.com');
  });

  it(':global mode falls back to :dnssrv when NANDA Index is unreachable (§15.4)', async () => {
    mockLookupNandaIndex.mockRejectedValueOnce(
      new NandaIndexError('NANDA Index unreachable', 'unreachable'),
    );
    mockLookupViaDnsSrv.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockResolvedValueOnce(TEST_AGENT_CARD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ResolveResponse>();
    expect(body.resolved_via).toBe('dns-srv:nasiko.com');
    expect(mockLookupViaDnsSrv).toHaveBeenCalledWith('scheduler@nasiko.com', 'nasiko.com');
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('returns 400 when locator query param is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/resolve' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 with invalid_locator when mode suffix is missing', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_locator');
  });

  it('returns 400 with invalid_locator for unknown mode', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Ahttp',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_locator');
  });

  it('returns 404 when agent is not found in NANDA Index', async () => {
    mockLookupNandaIndex.mockRejectedValueOnce(
      new NandaIndexError('agent not found', 'not_found'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=unknown%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 404 when DNS SRV record is absent', async () => {
    mockLookupViaDnsSrv.mockRejectedValueOnce(
      new DnsSrvError('no SRV record', 'no_srv_record'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Adnssrv',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_srv_record');
  });

  it('returns 503 when :global NANDA Index and :dnssrv fallback both fail', async () => {
    mockLookupNandaIndex.mockRejectedValueOnce(
      new NandaIndexError('NANDA Index unreachable', 'unreachable'),
    );
    mockLookupViaDnsSrv.mockRejectedValueOnce(
      new DnsSrvError('DNS SRV unreachable', 'unreachable'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('unreachable');
  });

  it('returns 429 when NANDA Index rate-limits and :nandaindex.org mode is used', async () => {
    mockLookupNandaIndex.mockRejectedValueOnce(
      new NandaIndexError('rate limited', 'rate_limited'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Anandaindex.org',
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('rate_limited');
  });

  it('returns 502 when AgentCard is malformed', async () => {
    mockLookupNandaIndex.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockRejectedValueOnce(
      new AgentCardError('missing required fields', 'malformed'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('card_malformed');
  });

  it('returns 503 when AgentCard URL is unreachable', async () => {
    mockLookupNandaIndex.mockResolvedValueOnce(TEST_INDEX_RECORD);
    mockFetchAgentCard.mockRejectedValueOnce(
      new AgentCardError('card URL unreachable', 'unreachable'),
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Aglobal',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('unreachable');
  });
});