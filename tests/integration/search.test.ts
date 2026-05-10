import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/lib/dnsVerification.js', () => ({
  verifyDmarcTxt: vi.fn().mockResolvedValue('v=DMARC1; p=reject'),
}));
vi.mock('../../src/lib/rapVerification.js', () => ({
  headRap: vi.fn().mockResolvedValue(undefined),
}));

import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { insertEntityOwner } from '../../src/db/queries/entityOwners.js';
import { buildConfig } from '../../src/config/index.js';
import { signCanonical } from '../../src/services/signing.js';

async function seedOwner(ownerId: string, domain: string, displayName: string): Promise<void> {
  const config = buildConfig();
  const { publicKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const rootPublicKey = createPublicKey(config.signing.privateKey)
    .export({ type: 'spki', format: 'pem' }) as string;

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 86400 * 1000);
  const serial = '2026051000';

  const wirePayload: Record<string, unknown> = {
    owner_id: ownerId, display_name: displayName, domain,
    contact_email: `admin@${domain}`,
    rap_url: `https://${domain}/agents.json`,
    rap_fallback: null, algorithm: 'ed25519', public_key: publicKey,
    key_id: 'seed-key-1', ttl_seconds: 86400, serial, status: 'active',
    issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString(),
    signed_by: config.signing.keyId,
  };

  await insertEntityOwner({
    ownerId, displayName, domain,
    contactEmail: `admin@${domain}`,
    rapUrl: `https://${domain}/agents.json`,
    rapFallback: null, algorithm: 'ed25519', publicKey: rootPublicKey,
    keyId: 'seed-key-1', dmarcPolicy: 'v=DMARC1; p=reject',
    ttlSeconds: 86400, serial, issuedAt, expiresAt,
    signatureValue: signCanonical(wirePayload, config.signing.privateKey),
    signedBy: config.signing.keyId,
  });
}

describe('GET /api/v1/search', () => {
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
    const sql = getSql();
    await sql`DELETE FROM entity_owners WHERE owner_id LIKE 'srch-%'`;
  });

  // ─── Schema / validation guards ──────────────────────────────────────────

  it('returns 400 when q is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when q is a single character after trimming', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=a' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('query_too_short');
  });

  // ─── Empty results ────────────────────────────────────────────────────────

  it('returns 200 with empty results when nothing matches', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=zzznomatch' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  // ─── Matching ─────────────────────────────────────────────────────────────

  it('finds an owner by owner_id prefix', async () => {
    await seedOwner('srch-alpha', 'alpha.example.com', 'Alpha Corp');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=srch-al' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].owner_id).toBe('srch-alpha');
  });

  it('finds an owner by domain substring', async () => {
    await seedOwner('srch-beta', 'beta.example.com', 'Beta Corp');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=beta.example' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].domain).toBe('beta.example.com');
  });

  it('finds an owner by display_name substring', async () => {
    await seedOwner('srch-gamma', 'gamma.example.com', 'Gamma Industries');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=gamma ind' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].display_name).toBe('Gamma Industries');
  });

  it('returns multiple results and ranks exact owner_id match first', async () => {
    await seedOwner('srch-exact', 'srch-exact.example.com', 'Exact Match Co');
    await seedOwner('srch-exact-too', 'srch-extra.example.com', 'Near Match Co');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=srch-exact' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    // Exact match on owner_id comes first (rank 0)
    expect(body.results[0].owner_id).toBe('srch-exact');
  });

  it('response shape matches SearchResponse schema', async () => {
    await seedOwner('srch-delta', 'delta.example.com', 'Delta Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=srch-delta' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.query).toBe('string');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results[0]).toMatchObject({
      owner_id: 'srch-delta',
      status: 'active',
      algorithm: 'ed25519',
    });
  });
});
