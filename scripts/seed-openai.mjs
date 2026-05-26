// Pre-seed one real-domain row (github.com) so the Browse Registries
// page already has a fancy entry before the live demo registers anthropic.com.
import { generateKeyPairSync, sign } from 'node:crypto';

const API = 'http://localhost:3000';
const ownerId = 'github-demo';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

const r1 = await fetch(API + '/api/v1/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    owner_id: ownerId,
    display_name: 'GitHub Demo Registry',
    domain: 'github.com',
    contact_email: 'demo@github.com',
    rap_url: 'https://api.github.com/',
    algorithm: 'ed25519',
    public_key: pubPem,
    key_id: ownerId + '-key-001',
    ttl_seconds: 86400,
  }),
});
const j1 = await r1.json();
if (r1.status !== 202) { console.error('step1 failed', j1); process.exit(1); }

const sig = sign(null, Buffer.from(j1.challenge_nonce, 'hex'), privateKey).toString('base64');
const r2 = await fetch(API + '/api/v1/register/' + ownerId + '/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challenge_signature: sig }),
});
const j2 = await r2.json();
console.log('status:', r2.status, 'owner_id:', j2.owner_id, 'domain:', j2.domain);
