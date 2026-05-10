import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import type { GlobalAgentRoot } from '../../src/types/api/manifest.js';

// Keypair for the test owner rows — only the public key lands in the DB
const { publicKey: testPubKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TEST_OWNER_ID = 'test-manifest-org';
const TEST_DOMAIN = 'test-manifest.example.com';
const TEST_SERIAL = '2026051000';

/** Inserts a minimal active EntityOwner row directly. Bypasses the write-path pipeline. */
async function insertTestOwner(status: 'active' | 'suspended' | 'stale' = 'active'): Promise<void> {
  const sql = getSql();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86400 * 1000);
  await sql`
    INSERT INTO entity_owners (
      owner_id, display_name, domain, contact_email,
      rap_url, algorithm, public_key, key_id,
      dmarc_policy, serial, status, issued_at, expires_at,
      signature_value, signed_by
    ) VALUES (
      ${TEST_OWNER_ID}, 'Test Manifest Org', ${TEST_DOMAIN},
      'admin@test-manifest.example.com',
      'https://test-manifest.example.com/agents.json',
      'ed25519', ${testPubKey}, 'test-key-1',
      'v=DMARC1; p=reject', ${TEST_SERIAL}, ${status}, ${now}, ${expiresAt},
      ${'dGVzdC1zaWduYXR1cmU='}, 'garr-dev-unspecified'
    )
  `;
}

describe('GET /global_agent_root.json', () => {
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
    await sql`DELETE FROM entity_owners WHERE owner_id = ${TEST_OWNER_ID}`;
  });

  it('returns 200 with valid manifest shape (test owner absent before insertion)', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/global_agent_root.json' });
    expect(res.statusCode).toBe(200);

    const body = res.json<GlobalAgentRoot>();
    expect(body.version).toBe('1.1');
    expect(Array.isArray(body.entity_owners)).toBe(true);
    expect(body.signature_value).toBeTruthy();
    expect(body.signature_algorithm).toBe('ed25519');
    expect(body.signed_by).toBeTruthy();
    expect(new Date(body.issued_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
    // test owner not yet inserted — must not appear
    expect(body.entity_owners.some((o) => o.owner_id === TEST_OWNER_ID)).toBe(false);
  });

  it('serial matches YYYYMMDDNN format', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/global_agent_root.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json<GlobalAgentRoot>().serial).toMatch(/^\d{10}$/);
  });

  it('includes active owner in entity_owners', async () => {
    await insertTestOwner('active');

    const res = await fastify.inject({ method: 'GET', url: '/global_agent_root.json' });
    expect(res.statusCode).toBe(200);

    const body = res.json<GlobalAgentRoot>();
    const found = body.entity_owners.find((o) => o.owner_id === TEST_OWNER_ID);
    expect(found).toBeDefined();
    expect(found!.domain).toBe(TEST_DOMAIN);
    expect(found!.status).toBe('active');
  });

  it('excludes suspended owners', async () => {
    await insertTestOwner('suspended');

    const res = await fastify.inject({ method: 'GET', url: '/global_agent_root.json' });
    expect(res.statusCode).toBe(200);
    // suspended owner must not appear in the manifest
    const body = res.json<GlobalAgentRoot>();
    expect(body.entity_owners.some((o) => o.owner_id === TEST_OWNER_ID)).toBe(false);
  });

  it('manifest root signature is valid over canonical JSON', async () => {
    await insertTestOwner('active');

    const res = await fastify.inject({ method: 'GET', url: '/global_agent_root.json' });
    expect(res.statusCode).toBe(200);
    const manifest = res.json<GlobalAgentRoot>();

    const { verifyCanonical } = await import('../../src/services/signing.js');
    const { buildConfig } = await import('../../src/config/index.js');
    const config = buildConfig();

    // Derive the root public key from the private signing key
    const rootPubKey = createPublicKey(config.signing.privateKey).export({
      type: 'spki',
      format: 'pem',
    }) as string;

    // Valid key: signature must verify
    expect(
      verifyCanonical(
        manifest as unknown as Record<string, unknown>,
        manifest.signature_value,
        rootPubKey,
        'ed25519',
      ),
    ).toBe(true);

    // Wrong key: tamper detection must reject
    const { publicKey: wrongKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    expect(
      verifyCanonical(
        manifest as unknown as Record<string, unknown>,
        manifest.signature_value,
        wrongKey,
        'ed25519',
      ),
    ).toBe(false);
  });
});