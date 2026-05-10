import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
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
import { createPublicKey } from 'node:crypto';

const TEST_OWNER_ID = 'test-owners-read';
const TEST_DOMAIN = 'test-owners-read.example.com';

/** Seeds one active EntityOwner directly into the DB, bypassing the HTTP flow. */
async function seedOwner(ownerId: string, domain: string): Promise<void> {
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
    owner_id: ownerId,
    display_name: `Test Owner ${ownerId}`,
    domain,
    contact_email: `admin@${domain}`,
    rap_url: `https://${domain}/agents.json`,
    rap_fallback: null,
    algorithm: 'ed25519',
    public_key: publicKey,
    key_id: 'seed-key-1',
    ttl_seconds: 86400,
    serial,
    status: 'active',
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    signed_by: config.signing.keyId,
  };

  const signatureValue = signCanonical(wirePayload, config.signing.privateKey);

  await insertEntityOwner({
    ownerId,
    displayName: `Test Owner ${ownerId}`,
    domain,
    contactEmail: `admin@${domain}`,
    rapUrl: `https://${domain}/agents.json`,
    rapFallback: null,
    algorithm: 'ed25519',
    publicKey: rootPublicKey,
    keyId: 'seed-key-1',
    dmarcPolicy: 'v=DMARC1; p=reject',
    ttlSeconds: 86400,
    serial,
    issuedAt,
    expiresAt,
    signatureValue,
    signedBy: config.signing.keyId,
  });
}

describe('GET /api/v1/owners/:owner_id', () => {
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

  afterEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM entity_owners WHERE owner_id LIKE 'test-owners-%'`;
  });

  // ─── Schema guard ────────────────────────────────────────────────────────

  it('rejects 400 when owner_id contains uppercase', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/owners/Test-Org' });
    expect(res.statusCode).toBe(400);
  });

  // ─── Miss ────────────────────────────────────────────────────────────────

  it('returns 404 when owner_id does not exist', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/owners/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  // ─── Hit ─────────────────────────────────────────────────────────────────

  it('returns 200 with EntityOwnerWire on a known owner_id', async () => {
    await seedOwner(TEST_OWNER_ID, TEST_DOMAIN);

    const res = await fastify.inject({ method: 'GET', url: `/api/v1/owners/${TEST_OWNER_ID}` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.owner_id).toBe(TEST_OWNER_ID);
    expect(body.domain).toBe(TEST_DOMAIN);
    expect(body.status).toBe('active');
    expect(body.serial).toMatch(/^\d{10}$/);
    expect(body.signature_value).toBeTruthy();
    expect(body.issued_at).toBeTruthy();
    expect(body.expires_at).toBeTruthy();
  });
});
