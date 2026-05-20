// Cross-registry demo seed.
//
// Walks both demo registries (google-demo, walmart-demo) through the live
// GARR registration flow (using mock-verification mode to bypass DMARC +
// RAP) and writes signed AgentCards + IndexRecords into db/seed/*.json so
// the mock NANDA / registry gateway endpoints can serve them.
//
// Idempotent on re-run:
//   - keys are loaded from disk if they exist (so signatures keep matching
//     the public_key already stored in entity_owners)
//   - a 409 from POST /api/v1/register is treated as "already registered,
//     fine — just regenerate the seed JSON"

import {
  generateKeyPairSync,
  sign as cryptoSign,
  createPrivateKey,
} from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3000';

// ── canonical JSON (mirrors src/services/signing.ts) ─────────────────────
function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') +
      '}'
    );
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

function signCanonical(record, privateKeyPem) {
  const { signature: _s1, signature_value: _s2, ...payload } = record;
  void _s1; void _s2;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  return cryptoSign(null, data, createPrivateKey(privateKeyPem)).toString('base64');
}

// ── demo data ────────────────────────────────────────────────────────────
const REGISTRIES = [
  {
    slug: 'google-demo',
    displayName: 'Google Demo Registry',
    domain: 'google-demo.local',
    agents: [
      {
        name: 'search-bot',
        displayName: 'Search Bot',
        description: 'Performs web search and returns ranked summaries.',
        capabilities: ['web.search', 'web.summarize'],
      },
      {
        name: 'gmail-summarizer',
        displayName: 'Gmail Summarizer',
        description: 'Reads inbox threads and emits short summaries.',
        capabilities: ['email.read', 'email.summarize'],
      },
      {
        name: 'calendar-scheduler',
        displayName: 'Calendar Scheduler',
        description: 'Finds free slots and books meetings across calendars.',
        capabilities: ['calendar.read', 'calendar.write', 'calendar.suggest'],
      },
      {
        name: 'translate',
        displayName: 'Translate',
        description: 'Translates text across 100+ languages.',
        capabilities: ['text.translate', 'text.detect-language'],
      },
      {
        name: 'maps-router',
        displayName: 'Maps Router',
        description: 'Computes driving / transit routes between locations.',
        capabilities: ['maps.route', 'maps.geocode'],
      },
    ],
  },
  {
    slug: 'walmart-demo',
    displayName: 'Walmart Demo Registry',
    domain: 'walmart-demo.local',
    agents: [
      {
        name: 'inventory-lookup',
        displayName: 'Inventory Lookup',
        description: 'Checks stock and store availability for a SKU.',
        capabilities: ['inventory.read', 'inventory.search'],
      },
      {
        name: 'order-status',
        displayName: 'Order Status',
        description: 'Reports current status and timeline for an order.',
        capabilities: ['orders.read', 'orders.track'],
      },
      {
        name: 'price-checker',
        displayName: 'Price Checker',
        description: 'Looks up current price and rollback eligibility.',
        capabilities: ['catalog.price', 'catalog.compare'],
      },
      {
        name: 'delivery-tracker',
        displayName: 'Delivery Tracker',
        description: 'Tracks last-mile delivery progress and ETA.',
        capabilities: ['delivery.track', 'delivery.eta'],
      },
      {
        name: 'returns-bot',
        displayName: 'Returns Bot',
        description: 'Initiates returns and reports refund status.',
        capabilities: ['returns.start', 'returns.status', 'returns.refund'],
      },
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────
function ensureDirs() {
  const seedDir = path.resolve('db/seed');
  const keysDir = path.join(seedDir, 'keys');
  if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true });
  return { seedDir, keysDir };
}

function ensureKeys(slug, keysDir) {
  const privFile = path.join(keysDir, `${slug}-private.pem`);
  const pubFile = path.join(keysDir, `${slug}-public.pem`);
  if (existsSync(privFile) && existsSync(pubFile)) {
    return {
      privPem: readFileSync(privFile, 'utf8'),
      pubPem: readFileSync(pubFile, 'utf8'),
      generated: false,
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(privFile, privPem);
  writeFileSync(pubFile, pubPem);
  return { privPem, pubPem, generated: true };
}

async function registerOwner(reg, pubPem, privPem) {
  const ownerId = reg.slug;
  const payload = {
    owner_id: ownerId,
    display_name: reg.displayName,
    domain: reg.domain,
    contact_email: `admin@${reg.domain}`,
    rap_url: `https://${reg.domain}/agents.json`,
    algorithm: 'ed25519',
    public_key: pubPem,
    key_id: `${ownerId}-key-001`,
    ttl_seconds: 86400,
  };

  let r = await fetch(`${API}/api/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (r.status === 409) {
    console.log(`  [${ownerId}] already registered — reusing existing record`);
    return;
  }
  if (r.status === 422) {
    const body = await r.text();
    throw new Error(
      `[${ownerId}] verify-time rejection (HTTP 422): ${body}\n` +
        '  → make sure GARR_MOCK_VERIFICATION=true is set on the server.',
    );
  }
  if (r.status !== 202) {
    const body = await r.text();
    throw new Error(`[${ownerId}] register failed: HTTP ${r.status} ${body}`);
  }

  const { challenge_nonce } = await r.json();
  const sig = cryptoSign(
    null,
    Buffer.from(challenge_nonce, 'hex'),
    createPrivateKey(privPem),
  ).toString('base64');

  r = await fetch(`${API}/api/v1/register/${ownerId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_signature: sig }),
  });
  if (r.status !== 201) {
    const body = await r.text();
    throw new Error(`[${ownerId}] verify failed: HTTP ${r.status} ${body}`);
  }
  console.log(`  [${ownerId}] registered + verified (201)`);
}

function buildAgentArtifacts(reg, agentSpec, privPem) {
  const agentId = `${agentSpec.name}@${reg.domain}`;
  const cardUrl = `${API}/mock/registries/${reg.slug}/cards/${agentId}`;
  const invocationUrl = `${API}/mock/agents/${reg.slug}/invoke`;

  const cardWithoutSig = {
    id: agentId,
    display_name: agentSpec.displayName,
    description: agentSpec.description,
    capabilities: agentSpec.capabilities,
    invocation_url: invocationUrl,
    protocol: 'a2a',
    visibility: 'public',
  };
  const cardSig = signCanonical(cardWithoutSig, privPem);
  const agentCard = { ...cardWithoutSig, signature: cardSig };

  const indexWithoutSig = {
    agent_id: agentId,
    agent_name: agentSpec.displayName,
    card_url: cardUrl,
    ttl: 3600,
  };
  const indexSig = signCanonical(indexWithoutSig, privPem);
  const indexRecord = { ...indexWithoutSig, signature: indexSig };

  return { agent_id: agentId, index_record: indexRecord, agent_card: agentCard };
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DEMO SEED — Google + Walmart cross-registry demo');
  console.log('  Requires:  GARR_MOCK_VERIFICATION=true on the server');
  console.log('             dev server running on :3000');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  try {
    const r = await fetch(`${API}/health`);
    if (r.status !== 200 && r.status !== 503) {
      throw new Error(`unexpected /health status ${r.status}`);
    }
    if (r.status === 503) {
      console.warn('  ⚠ /health says DB unreachable — registration will fail until Postgres is up.');
    }
  } catch (e) {
    console.error(`Server not reachable at ${API}: ${e.message}`);
    process.exit(1);
  }

  const { seedDir, keysDir } = ensureDirs();

  for (const reg of REGISTRIES) {
    console.log(`▶ ${reg.slug}`);

    const { privPem, pubPem, generated } = ensureKeys(reg.slug, keysDir);
    console.log(`  keys: ${generated ? 'generated new' : 'loaded from disk'}`);

    await registerOwner(reg, pubPem, privPem);

    const agents = reg.agents.map((a) => buildAgentArtifacts(reg, a, privPem));
    const seedFile = {
      slug: reg.slug,
      owner_id: reg.slug,
      agents,
    };

    // File names are short (google.json / walmart.json); slug field carries
    // the full owner_id used by the routes.
    const fileBaseName = reg.slug.replace(/-demo$/, '');
    const outFile = path.join(seedDir, `${fileBaseName}.json`);
    writeFileSync(outFile, JSON.stringify(seedFile, null, 2));
    console.log(`  wrote ${path.relative(process.cwd(), outFile)} (${agents.length} agents)`);
    console.log('');
  }

  console.log('Seed complete. Try:');
  console.log(`  curl ${API}/api/v1/owners/google-demo`);
  console.log(`  curl '${API}/mock/nanda/lookup?agent=search-bot@google-demo.local'`);
  console.log(`  curl '${API}/mock/registries/google-demo/cards/search-bot@google-demo.local'`);
  console.log('');
}

main().catch((err) => {
  console.error('\nseed failed:', err.message);
  process.exit(1);
});