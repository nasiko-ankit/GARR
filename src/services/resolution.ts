import { findByDomain, findByOrgId, toIndexRecord } from '../db/queries/organizations.js';
import type { AgentRecord } from '../types/api/agent-record.js';
import type { ParsedLocator, ResolveResponse } from '../types/api/resolve.js';

/**
 * Structured error thrown by resolveAgent — route maps code to HTTP status.
 */
export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'    // 404
      | 'unreachable'  // 503
      | 'bad_request'  // 400
      | 'bad_response' // 502
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/**
 * Resolves an agent locator to an AgentRecord via 2-hop lookup:
 *   1. NANDA Index DB → IndexRecord (contains registry_url)
 *   2. Registry Server HTTP GET → AgentRecord (contains card_url)
 *
 * The caller uses agent_record.card_url to fetch the A2A card.
 *
 * @param locator - parsed locator from parseLocator()
 * @returns ResolveResponse with index_record and agent_record
 * @throws ResolutionError
 */
export async function resolveAgent(locator: ParsedLocator): Promise<ResolveResponse> {
  const { identifier, namespace, agentId } = locator;

  // Step 1: lookup org by domain or org_id slug in NANDA Index DB
  let org = await findByDomain(namespace);
  if (!org) {
    // Try matching by org_id slug (e.g. "nasiko" vs "nasiko.com")
    const slug = namespace.replace(/\.[^.]+$/, '');
    org = await findByOrgId(slug);
  }

  if (!org || org.status !== 'active') {
    throw new ResolutionError(
      `namespace "${namespace}" not found in NANDA Index or is not active`,
      'not_found',
    );
  }

  const indexRecord = toIndexRecord(org);

  // Step 2: fetch AgentRecord from the org's Registry Server
  const registryUrl = org.registryUrl.replace(/\/+$/, '');
  const agentUrl = `${registryUrl}/agents/${encodeURIComponent(identifier)}`;

  let agentRecord: AgentRecord;
  try {
    const resp = await fetch(agentUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 404) {
      throw new ResolutionError(
        `agent "${identifier}" not found in registry at ${registryUrl}`,
        'not_found',
      );
    }
    if (!resp.ok) {
      throw new ResolutionError(
        `registry server at ${registryUrl} returned HTTP ${resp.status}`,
        'unreachable',
      );
    }

    const body = await resp.json() as unknown;
    if (!isAgentRecord(body)) {
      throw new ResolutionError(
        `registry server at ${registryUrl} returned a malformed agent record`,
        'bad_response',
      );
    }
    agentRecord = body;
  } catch (err) {
    if (err instanceof ResolutionError) throw err;
    throw new ResolutionError(
      `could not reach registry server at ${registryUrl}: ${String(err)}`,
      'unreachable',
    );
  }

  return {
    locator: agentId + ':global',
    index_record: indexRecord,
    agent_record: agentRecord,
  };
}

/** Minimal shape guard for AgentRecord — card_url and agent_id are required. */
function isAgentRecord(value: unknown): value is AgentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['agent_id'] === 'string' && typeof v['card_url'] === 'string';
}
