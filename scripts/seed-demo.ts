/**
 * Seed demo — generates real ed25519 key pairs for 3 demo orgs, writes
 * private keys to .keys.demo.json, and registers each org via the GARR
 * registration API.
 *
 * Requires the GARR server to be running with GARR_DEMO_MODE=true.
 * Run: npm run demo:seed
 */

import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Allow overriding the GARR base URL for CI / remote envs
// eslint-disable-next-line n/no-process-env
const GARR_BASE = process.env['GARR_URL'] ?? 'http://localhost:3000';
const KEYS_FILE = join(__dirname, '..', '.keys.demo.json');

interface OrgDef {
  owner_id: string;
  display_name: string;
  domain: string;
  contact_email: string;
  rap_url: string;
  key_id: string;
}

const ORGS: OrgDef[] = [
  {
    owner_id: 'acme',
    display_name: 'Acme Corp',
    domain: 'acme.demo',
    contact_email: 'registrar@acme.demo',
    rap_url: 'http://localhost:4001',
    key_id: 'acme-agent-root-demo',
  },
  {
    owner_id: 'globex',
    display_name: 'Globex Inc',
    domain: 'globex.demo',
    contact_email: 'registrar@globex.demo',
    rap_url: 'http://localhost:4002',
    key_id: 'globex-agent-root-demo',
  },
  {
    owner_id: 'initech',
    display_name: 'Initech LLC',
    domain: 'initech.demo',
    contact_email: 'registrar@initech.demo',
    rap_url: 'http://localhost:4003',
    key_id: 'initech-agent-root-demo',
  },
];

interface KeyPair {
  privateKey: string;
  publicKey: string;
}

type KeyStore = Record<string, KeyPair>;

/**
 * Generates a fresh ed25519 key pair and returns PEM strings.
 */
function generateEd25519KeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Runs the two-step registration flow for a single org:
 *   1. POST /api/v1/register        → receive challenge nonce
 *   2. Sign nonce with org private key
 *   3. POST /api/v1/register/:id/verify → EntityOwner created
 */
async function registerOrg(org: OrgDef, keys: KeyPair): Promise<void> {
  console.log(`\n→ Registering ${org.owner_id} (${org.domain})…`);

  // Step 1 — initiate registration
  const initRes = await postJson(`${GARR_BASE}/api/v1/register`, {
    owner_id: org.owner_id,
    display_name: org.display_name,
    domain: org.domain,
    contact_email: org.contact_email,
    rap_url: org.rap_url,
    algorithm: 'ed25519',
    public_key: keys.publicKey,
    key_id: org.key_id,
    ttl_seconds: 86400,
  });

  if (initRes.status !== 202) {
    const text = await initRes.text();
    throw new Error(
      `Registration initiation failed for ${org.owner_id}: HTTP ${initRes.status} — ${text}`,
    );
  }

  const initBody = (await initRes.json()) as { challenge_nonce: string };
  const nonce = initBody.challenge_nonce;
  console.log(`  challenge nonce: ${nonce.slice(0, 16)}…`);

  // Step 2 — sign the nonce: server verifies over the raw 32 bytes the hex decodes to
  const nonceBytes = Buffer.from(nonce, 'hex');
  const privKey = createPrivateKey(keys.privateKey);
  const challengeSignature = sign(null, nonceBytes, privKey).toString('base64');

  // Step 3 — complete registration
  const verifyRes = await postJson(
    `${GARR_BASE}/api/v1/register/${org.owner_id}/verify`,
    { challenge_signature: challengeSignature },
  );

  if (verifyRes.status !== 201) {
    const text = await verifyRes.text();
    throw new Error(
      `Challenge verification failed for ${org.owner_id}: HTTP ${verifyRes.status} — ${text}`,
    );
  }

  console.log(`✓ ${org.owner_id} registered successfully`);
}

async function main(): Promise<void> {
  console.log('GARR Demo Seed');
  console.log(`Target: ${GARR_BASE}\n`);

  // Generate fresh key pairs for all orgs
  const keyStore: KeyStore = {};
  for (const org of ORGS) {
    keyStore[org.owner_id] = generateEd25519KeyPair();
    console.log(`  generated key pair for ${org.owner_id}`);
  }

  // Write private keys to .keys.demo.json (gitignored, read by mock-rap.ts)
  writeFileSync(KEYS_FILE, JSON.stringify(keyStore, null, 2), 'utf8');
  console.log(`\n✓ Keys written to .keys.demo.json`);

  // Register each org via the GARR API
  for (const org of ORGS) {
    await registerOrg(org, keyStore[org.owner_id]!);
  }

  console.log('\n✓ All demo orgs registered.');
  console.log('  Next: npm run demo:rap   (in a new terminal)');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
