import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { IndexRecord, AgentCard } from '../types/api/resolve.js';
import { signCanonical } from '../services/signing.js';

/**
 * Demo-only seed store. Loaded by the mock NANDA / registry / A2A routes
 * to simulate the rest of the world without standing up a real index or
 * real registry gateways.
 *
 * Seed files live at `db/seed/*.json`. Each file describes one registry
 * (one EntityOwner slug) plus its agents:
 *
 *   {
 *     "slug": "google-demo",
 *     "owner_id": "google-demo",
 *     "agents": [
 *       { "agent_id": "search-bot@google-demo.local",
 *         "index_record": { ... IndexRecord ... },
 *         "agent_card":   { ... AgentCard   ... }
 *       }
 *     ]
 *   }
 *
 * Re-reads from disk on every call. Seeds are tiny (≤ a few KB each) and
 * dev-only — the I/O cost is irrelevant and it means re-running the seed
 * script picks up immediately without a server restart.
 */

export interface SeedAgent {
  agent_id: string;
  index_record: IndexRecord;
  agent_card: AgentCard;
}

export interface SeedFile {
  slug: string;
  owner_id: string;
  agents: SeedAgent[];
}

const SEED_DIR = path.resolve(process.cwd(), 'db/seed');

function loadAllSeeds(): SeedFile[] {
  if (!existsSync(SEED_DIR)) {
    console.warn(`seedStore: ${SEED_DIR} does not exist — mock endpoints will 404 until seeds are written.`);
    return [];
  }

  let files: string[];
  try {
    files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.warn(`seedStore: failed to list ${SEED_DIR}: ${(err as Error).message}`);
    return [];
  }

  const seeds: SeedFile[] = [];
  for (const file of files) {
    const fullPath = path.join(SEED_DIR, file);
    try {
      const raw = readFileSync(fullPath, 'utf8');
      seeds.push(JSON.parse(raw) as SeedFile);
    } catch (err) {
      console.warn(`seedStore: failed to parse ${file}: ${(err as Error).message}`);
    }
  }
  return seeds;
}

/**
 * Cross-registry agent lookup — used by the mock NANDA Index endpoint.
 * Searches every seed file for an agent matching `agentId`.
 */
export function lookupAgent(agentId: string): IndexRecord | null {
  for (const seed of loadAllSeeds()) {
    const agent = seed.agents.find((a) => a.agent_id === agentId);
    if (agent) return agent.index_record;
  }
  return null;
}

/**
 * Per-registry card lookup — used by the mock registry gateway endpoint.
 * `slug` matches the SeedFile.slug field (EntityOwner slug, e.g. "google-demo"),
 * not the on-disk filename.
 */
export function getCard(slug: string, agentId: string): AgentCard | null {
  for (const seed of loadAllSeeds()) {
    if (seed.slug !== slug) continue;
    const agent = seed.agents.find((a) => a.agent_id === agentId);
    return agent?.agent_card ?? null;
  }
  return null;
}

/**
 * Same shape as getCard; named separately so the A2A invoke handler reads
 * naturally ("look up the agent on the callee's registry"). One function
 * would do, but the alias keeps call sites self-documenting.
 */
export const getAgentBySlug = getCard;

// ── write side (Layer 2) ─────────────────────────────────────────────────

/** Draft an agent record submitted by the registry-owner UI. */
export interface AgentDraft {
  /** Lowercase short name used as the identifier part of agent_id. */
  name: string;
  display_name: string;
  description: string;
  capabilities: string[];
}

export type AddAgentError =
  | { code: 'registry_not_found'; detail: string }
  | { code: 'private_key_missing'; detail: string }
  | { code: 'agent_id_conflict'; detail: string }
  | { code: 'persist_failed'; detail: string };

export type AddAgentResult =
  | { ok: true; agent_id: string; index_record: IndexRecord; agent_card: AgentCard }
  | { ok: false; error: AddAgentError };

/**
 * Returns the canonical SeedFile.slug-keyed lookup (e.g. "google-demo")
 * and its on-disk file path. Seed files are short-named on disk (google.json)
 * but the `slug` field inside carries the EntityOwner slug used everywhere
 * else. We resolve the file by reading every JSON and matching on slug.
 */
function locateSeedFile(slug: string): { seed: SeedFile; filePath: string } | null {
  if (!existsSync(SEED_DIR)) return null;
  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const fullPath = path.join(SEED_DIR, file);
    try {
      const raw = readFileSync(fullPath, 'utf8');
      const seed = JSON.parse(raw) as SeedFile;
      if (seed.slug === slug) return { seed, filePath: fullPath };
    } catch {
      /* skip unparseable file */
    }
  }
  return null;
}

/** Load the registry's private PEM. Layered alongside the seed JSON in db/seed/keys/. */
function loadPrivateKey(slug: string): string | null {
  const keyFile = path.join(SEED_DIR, 'keys', `${slug}-private.pem`);
  if (!existsSync(keyFile)) return null;
  try {
    return readFileSync(keyFile, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Adds a new agent to the named registry. Signs the AgentCard and
 * IndexRecord with the registry's private key (loaded from disk) and
 * appends the entry to the on-disk seed JSON. Idempotency is by
 * agent_id — duplicates return `agent_id_conflict`.
 *
 * @param slug      EntityOwner slug, e.g. "walmart-demo"
 * @param draft     UI-supplied fields
 * @param apiBase   URL prefix used to build card_url + invocation_url
 *                  (derived from the request host so links work cross-host)
 */
export function addAgent(
  slug: string,
  draft: AgentDraft,
  apiBase: string,
): AddAgentResult {
  const located = locateSeedFile(slug);
  if (!located) {
    return {
      ok: false,
      error: {
        code: 'registry_not_found',
        detail: `no seed file matches slug "${slug}". Run scripts/seed-demo.mjs first.`,
      },
    };
  }

  const privPem = loadPrivateKey(slug);
  if (!privPem) {
    return {
      ok: false,
      error: {
        code: 'private_key_missing',
        detail: `db/seed/keys/${slug}-private.pem not found. Cannot sign without the registry's key.`,
      },
    };
  }

  // agent_id derived from the EntityOwner's domain — same convention as
  // the seed script (e.g. "weather-bot@walmart-demo.local"). We synthesise
  // the domain from the slug because the seed file doesn't carry it; this
  // matches what scripts/seed-demo.mjs writes.
  const domain = `${slug}.local`;
  const agentId = `${draft.name}@${domain}`;

  if (located.seed.agents.some((a) => a.agent_id === agentId)) {
    return {
      ok: false,
      error: {
        code: 'agent_id_conflict',
        detail: `agent_id "${agentId}" already exists in registry "${slug}".`,
      },
    };
  }

  const cardUrl = `${apiBase}/mock/registries/${slug}/cards/${agentId}`;
  const invocationUrl = `${apiBase}/mock/agents/${slug}/invoke`;

  const cardUnsigned = {
    id: agentId,
    display_name: draft.display_name,
    description: draft.description,
    capabilities: draft.capabilities,
    invocation_url: invocationUrl,
    protocol: 'a2a',
    visibility: 'public' as const,
  };
  const cardSig = signCanonical(cardUnsigned, privPem);
  const agentCard: AgentCard = { ...cardUnsigned, signature: cardSig };

  const indexUnsigned = {
    agent_id: agentId,
    agent_name: draft.display_name,
    card_url: cardUrl,
    ttl: 3600,
  };
  const indexSig = signCanonical(indexUnsigned, privPem);
  const indexRecord: IndexRecord = { ...indexUnsigned, signature: indexSig };

  const updated: SeedFile = {
    ...located.seed,
    agents: [
      ...located.seed.agents,
      { agent_id: agentId, index_record: indexRecord, agent_card: agentCard },
    ],
  };

  try {
    writeFileSync(located.filePath, JSON.stringify(updated, null, 2));
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'persist_failed',
        detail: `failed to write ${located.filePath}: ${(err as Error).message}`,
      },
    };
  }

  return { ok: true, agent_id: agentId, index_record: indexRecord, agent_card: agentCard };
}

/** Lists the registries known to the mock store. Used by the UI's dropdown. */
export function listRegistries(): Array<{ slug: string; owner_id: string; agent_count: number }> {
  return loadAllSeeds().map((s) => ({
    slug: s.slug,
    owner_id: s.owner_id,
    agent_count: s.agents.length,
  }));
}