import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  createPrivateKey,
} from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ResolveResponse } from '../../src/types/api/resolve.js';

// Mock all external I/O before the server loads.
vi.mock('../../src/lib/nandaIndexClient.js', () => ({
  lookupNandaIndex: vi.fn(),
  NandaIndexError: class NandaIndexError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message); this.name = 'NandaIndexError';
    }
  },
}));

vi.mock('../../src/lib/dnsSrvResolver.js', () => ({
  lookupViaDnsSrv: vi.fn(),
  DnsSrvError: class DnsSrvError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message); this.name = 'DnsSrvError';
    }
  },
}));

vi.mock('../../src/lib/agentCardFetcher.js', () => ({
  fetchAgentCard: vi.fn(),
  AgentCardError: class AgentCardError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message); this.name = 'AgentCardError';
    }
  },
}));

import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { buildConfig } from '../../src/config/index.js';
import { signCanonical, canonicalize } from '../../src/services/signing.js';
import { lookupNandaIndex } from '../../src/lib/nandaIndexClient.js';
import { lookupViaDnsSrv } from '../../src/lib/dnsSrvResolver.js';
import { fetchAgentCard } from '../../src/lib/agentCardFetcher.js';
import { NandaIndexError } from '../../src/lib/nandaIndexClient.js';
import { DnsSrvError } from '../../src/lib/dnsSrvResolver.js';
import { AgentCardError } from '../../src/lib/agentCardFetcher.js';

const mockLookupNandaIndex = vi.mocked(lookupNandaIndex);
const mockLookupViaDnsSrv  = vi.mocked(lookupViaDnsSrv);
const mockFetchAgentCard   = vi.mocked(fetchAgentCard);

// ── Test constants ────────────────────────────────────────────────────────────

const RESOLVE_OWNER_ID  = 'test-resolve-owner';
const RESOLVE_DOMAIN    = 'resolve-test.example.com';
const RESOLVE_RAP_URL   = 'https://resolve-test.example.com/rap';
const RESOLVE_IDENTIFIER = 'billing-agent';
const RESOLVE_LOCATOR   = `${RESOLVE_IDENTIFIER}@${RESOLVE_DOMAIN}:global`;
const RESOLVE_CARD_URL  = `${RESOLVE_RAP_URL}/agents/${RESOLVE_IDENTIFIER}`;

/** Sign an AgentCard: canonicalize payload excluding 'signature', sign with ed25519. */
function signAgentCard(card: Record<string, unknown>, privKeyPem: string): string {
  const { signature: _strip, ...payload } = card;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  const key = createPrivateKey(privKeyPem);
  return cryptoSign(null, data, key).toString('base64');
}

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

  // ── :global mode (DB-backed, full signature chain) ─────────────────────────

  describe(':global mode', () => {
    // EntityOwner key pair — org signs its AgentCards with the private key;
    // the public key is stored in GARR and used to verify cards.
    const { privateKey: ownerPrivKey, publicKey: ownerPubKey } =
      generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      });

    // AgentCard payload (without 'signature') — signed in each test that needs it
    const agentCardBase: Record<string, unknown> = {
      id:             `${RESOLVE_IDENTIFIER}@${RESOLVE_DOMAIN}`,
      display_name:   'Billing Agent',
      description:    'Handles billing inquiries.',
      version:        '1.0.0',
      capabilities:   ['billing.invoice', 'billing.payment'],
      invocation_url: `${RESOLVE_RAP_URL}/invoke/${RESOLVE_IDENTIFIER}`,
      protocol:       'a2a',
      visibility:     'public',
      signed_by:      'test-owner-key-1',
      created_at:     '2026-01-01T00:00:00Z',
      updated_at:     '2026-01-01T00:00:00Z',
    };

    beforeAll(async () => {
      // Build and sign EntityOwner wire payload using GARR root key.
      // Must match exactly what completeRegistration produces (§4.5).
      const config = buildConfig();
      const issuedAt  = new Date('2026-01-01T00:00:00Z');
      const expiresAt = new Date('2027-01-01T00:00:00Z');
      const wirePayload: Record<string, unknown> = {
        owner_id:      RESOLVE_OWNER_ID,
        display_name:  'Test Resolve Org',
        domain:        RESOLVE_DOMAIN,
        contact_email: 'admin@resolve-test.example.com',
        rap_url:       RESOLVE_RAP_URL,
        rap_fallback:  null,
        algorithm:     'ed25519',
        public_key:    ownerPubKey,
        key_id:        'test-owner-key-1',
        ttl_seconds:   86400,
        serial:        '2026010100',
        status:        'active',
        issued_at:     issuedAt.toISOString(),
        expires_at:    expiresAt.toISOString(),
        signed_by:     config.signing.keyId,
      };
      const signatureValue = signCanonical(wirePayload, config.signing.privateKey);

      const sql = getSql();
      await sql`
        INSERT INTO entity_owners (
          owner_id, display_name, domain, contact_email,
          rap_url, rap_fallback, algorithm, public_key, key_id,
          dmarc_policy, ttl_seconds, serial, status,
          issued_at, expires_at, signature_value, signed_by
        ) VALUES (
          ${RESOLVE_OWNER_ID}, 'Test Resolve Org', ${RESOLVE_DOMAIN},
          'admin@resolve-test.example.com',
          ${RESOLVE_RAP_URL}, ${null}, 'ed25519', ${ownerPubKey},
          'test-owner-key-1', '', 86400, '2026010100', 'active',
          ${issuedAt}, ${expiresAt}, ${signatureValue}, ${config.signing.keyId}
        )
      `;
    });

    afterAll(async () => {
      const sql = getSql();
      await sql`DELETE FROM entity_owners WHERE owner_id = ${RESOLVE_OWNER_ID}`;
    });

    it('happy path returns verified AgentCard', async () => {
      const signature = signAgentCard(agentCardBase, ownerPrivKey);
      const signedCard = { ...agentCardBase, signature };

      mockFetchAgentCard.mockResolvedValueOnce(signedCard as ReturnType<typeof mockFetchAgentCard.mock.results[0]['value']>);

      const res = await fastify.inject({
        method: 'GET',
        url: `/api/v1/resolve?locator=${encodeURIComponent(RESOLVE_LOCATOR)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<ResolveResponse>();
      expect(body.locator).toBe(RESOLVE_LOCATOR);
      expect(body.resolution_mode).toBe('global');
      expect(body.resolved_via).toBe('garr-db');
      expect(body.index_record.agent_id).toBe(`${RESOLVE_IDENTIFIER}@${RESOLVE_DOMAIN}`);
      expect(body.index_record.card_url).toBe(RESOLVE_CARD_URL);
      expect(body.agent_card.id).toBe(`${RESOLVE_IDENTIFIER}@${RESOLVE_DOMAIN}`);
      expect(mockFetchAgentCard).toHaveBeenCalledWith(RESOLVE_CARD_URL, undefined);
    });

    it('unknown domain returns 404 NOT_FOUND', async () => {
      const res = await fastify.inject({
        method: 'GET',
        url: `/api/v1/resolve?locator=${encodeURIComponent(`${RESOLVE_IDENTIFIER}@unknown.example.com:global`)}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('RAP unreachable returns 503 RAP_UNREACHABLE', async () => {
      mockFetchAgentCard.mockRejectedValueOnce(
        new AgentCardError('connection refused', 'unreachable'),
      );

      const res = await fastify.inject({
        method: 'GET',
        url: `/api/v1/resolve?locator=${encodeURIComponent(RESOLVE_LOCATOR)}`,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('unreachable');
    });

    it('bad AgentCard signature returns 502 SIGNATURE_INVALID', async () => {
      // Generate a different key pair whose signature won't verify against ownerPubKey
      const { privateKey: wrongKey } = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      });
      const badSignature = signAgentCard(agentCardBase, wrongKey);
      const tamperedCard = { ...agentCardBase, signature: badSignature };

      mockFetchAgentCard.mockResolvedValueOnce(tamperedCard as ReturnType<typeof mockFetchAgentCard.mock.results[0]['value']>);

      const res = await fastify.inject({
        method: 'GET',
        url: `/api/v1/resolve?locator=${encodeURIComponent(RESOLVE_LOCATOR)}`,
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('signature_invalid');
    });
  });

  // ── :dnssrv mode ──────────────────────────────────────────────────────────

  describe(':dnssrv mode', () => {
    const DNSSRV_INDEX_RECORD = {
      agent_id:   'scheduler@nasiko.com',
      agent_name: 'Scheduler Agent',
      card_url:   'https://nasiko.com/agents/scheduler.json',
      ttl:        3600,
      signature:  'dGVzdC1zaWduYXR1cmU=',
    };

    const DNSSRV_AGENT_CARD = {
      id:             'scheduler@nasiko.com',
      display_name:   'Scheduler Agent',
      description:    'Schedules meetings and tasks.',
      capabilities:   ['schedule', 'remind'],
      invocation_url: 'https://nasiko.com/invoke/scheduler',
      protocol:       'a2a',
      visibility:     'public' as const,
      signature:      'dGVzdC1jYXJkLXNpZw==',
    };

    it('happy path resolves via DNS SRV and returns 200', async () => {
      mockLookupViaDnsSrv.mockResolvedValueOnce(DNSSRV_INDEX_RECORD);
      mockFetchAgentCard.mockResolvedValueOnce(DNSSRV_AGENT_CARD);

      const res = await fastify.inject({
        method: 'GET',
        url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Adnssrv',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<ResolveResponse>();
      expect(body.resolution_mode).toBe('dnssrv');
      expect(body.resolved_via).toBe('dns-srv:nasiko.com');
      expect(body.index_record.agent_id).toBe('scheduler@nasiko.com');
      expect(body.agent_card.id).toBe('scheduler@nasiko.com');
      expect(mockLookupViaDnsSrv).toHaveBeenCalledWith('scheduler@nasiko.com', 'nasiko.com');
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
  });

  // ── :nandaindex.org mode ──────────────────────────────────────────────────

  describe(':nandaindex.org mode', () => {
    const NANDA_INDEX_RECORD = {
      agent_id:   'scheduler@nasiko.com',
      agent_name: 'Scheduler Agent',
      card_url:   'https://nasiko.com/agents/scheduler.json',
      ttl:        3600,
      signature:  'dGVzdC1zaWduYXR1cmU=',
    };

    const NANDA_AGENT_CARD = {
      id:             'scheduler@nasiko.com',
      display_name:   'Scheduler Agent',
      description:    'Schedules meetings and tasks.',
      capabilities:   ['schedule'],
      invocation_url: 'https://nasiko.com/invoke/scheduler',
      protocol:       'a2a',
      visibility:     'public' as const,
      signature:      'dGVzdC1jYXJkLXNpZw==',
    };

    it('resolves via named NANDA Index and returns 200', async () => {
      mockLookupNandaIndex.mockResolvedValueOnce(NANDA_INDEX_RECORD);
      mockFetchAgentCard.mockResolvedValueOnce(NANDA_AGENT_CARD);

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

    it('returns 429 when NANDA Index rate-limits', async () => {
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
  });

  // ── Malformed / input errors ──────────────────────────────────────────────

  describe('input validation', () => {
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
  });

  // ── AgentCard error paths ─────────────────────────────────────────────────

  describe('AgentCard fetch errors (:nandaindex.org)', () => {
    const NANDA_INDEX_RECORD = {
      agent_id:   'scheduler@nasiko.com',
      agent_name: 'Scheduler Agent',
      card_url:   'https://nasiko.com/agents/scheduler.json',
      ttl:        3600,
      signature:  'dGVzdC1zaWduYXR1cmU=',
    };

    it('returns 502 when AgentCard is malformed', async () => {
      mockLookupNandaIndex.mockResolvedValueOnce(NANDA_INDEX_RECORD);
      mockFetchAgentCard.mockRejectedValueOnce(
        new AgentCardError('missing required fields', 'malformed'),
      );

      const res = await fastify.inject({
        method: 'GET',
        url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Anandaindex.org',
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('card_malformed');
    });

    it('returns 503 when AgentCard URL is unreachable', async () => {
      mockLookupNandaIndex.mockResolvedValueOnce(NANDA_INDEX_RECORD);
      mockFetchAgentCard.mockRejectedValueOnce(
        new AgentCardError('card URL unreachable', 'unreachable'),
      );

      const res = await fastify.inject({
        method: 'GET',
        url: '/api/v1/resolve?locator=scheduler%40nasiko.com%3Anandaindex.org',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('unreachable');
    });
  });
});
