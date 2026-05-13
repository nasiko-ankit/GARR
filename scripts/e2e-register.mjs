// E2E register flow test. Generates an Ed25519 keypair, runs the
// 2-step register flow, prints each response. Does NOT touch frontend.
import { generateKeyPairSync, sign } from 'node:crypto';

const API = 'http://localhost:3000';
const ownerId = 'anthropic-demo-' + Math.random().toString(36).slice(2, 8);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

const payload = {
  owner_id: ownerId,
  display_name: 'Anthropic Demo Registry',
  domain: 'anthropic.com',
  contact_email: 'demo@anthropic.com',
  rap_url: 'https://www.anthropic.com/',
  algorithm: 'ed25519',
  public_key: pubPem,
  key_id: ownerId + '-key-001',
  ttl_seconds: 86400,
};

console.log('[1] POST /api/v1/register with owner_id=' + ownerId);
const r1 = await fetch(API + '/api/v1/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const j1 = await r1.json();
console.log('    status:', r1.status);
console.log('    body  :', JSON.stringify(j1, null, 2));
if (r1.status !== 202) process.exit(1);

const sig = sign(null, Buffer.from(j1.challenge_nonce, 'hex'), privateKey).toString('base64');
console.log('\n[2] Signed nonce (base64):', sig.slice(0, 32) + '...');

console.log('\n[3] POST /api/v1/register/' + ownerId + '/verify');
const r2 = await fetch(API + '/api/v1/register/' + ownerId + '/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challenge_signature: sig }),
});
const j2 = await r2.json();
console.log('    status:', r2.status);
console.log('    body  :', JSON.stringify(j2, null, 2));
if (r2.status !== 201) process.exit(1);

console.log('\n[4] GET /api/v1/owners/' + ownerId);
const r3 = await fetch(API + '/api/v1/owners/' + ownerId);
console.log('    status:', r3.status);

console.log('\n[5] GET /api/v1/search?q=anthropic');
const r4 = await fetch(API + '/api/v1/search?q=anthropic');
const j4 = await r4.json();
console.log('    status:', r4.status, 'count:', j4.count);

console.log('\n[OK] owner_id =', ownerId);
