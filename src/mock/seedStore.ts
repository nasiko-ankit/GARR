import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { IndexRecord, AgentCard } from '../types/api/resolve.js';

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