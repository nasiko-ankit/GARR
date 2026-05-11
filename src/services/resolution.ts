import type { ParsedLocator, IndexRecord, AgentCard, ResolveResponse } from '../types/api/resolve.js';
import { lookupNandaIndex, NandaIndexError } from '../lib/nandaIndexClient.js';
import { lookupViaDnsSrv, DnsSrvError } from '../lib/dnsSrvResolver.js';
import { fetchAgentCard, AgentCardError } from '../lib/agentCardFetcher.js';

/** Structured error thrown by resolveAgent — route maps code to HTTP status. */
export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'        // 404
      | 'unreachable'      // 503
      | 'bad_request'      // 400
      | 'rate_limited'     // 429
      | 'no_srv_record'    // 404
      | 'card_malformed',  // 502
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** Returns { indexRecord, resolvedVia } for :global mode with :dnssrv fallback (§15.4). */
async function resolveGlobal(agentId: string, namespace: string): Promise<{ indexRecord: IndexRecord; resolvedVia: string }> {
  try {
    const indexRecord = await lookupNandaIndex(agentId);
    return { indexRecord, resolvedVia: 'nandaindex.org' };
  } catch (err) {
    if (!(err instanceof NandaIndexError)) throw err;

    if (err.code === 'not_found') {
      throw new ResolutionError(err.message, 'not_found');
    }

    if (err.code === 'bad_request') {
      throw new ResolutionError(err.message, 'bad_request');
    }

    // unreachable or rate_limited — §15.4 fallback to :dnssrv
    try {
      const indexRecord = await lookupViaDnsSrv(agentId, namespace);
      return { indexRecord, resolvedVia: `dns-srv:${namespace}` };
    } catch (dnserr) {
      throw new ResolutionError(
        `NANDA Index unreachable and DNS SRV fallback failed for "${agentId}": ${(dnserr as Error).message}`,
        'unreachable',
      );
    }
  }
}

/** Returns { indexRecord, resolvedVia } for :nandaindex.org mode (no fallback). */
async function resolveNandaIndex(agentId: string): Promise<{ indexRecord: IndexRecord; resolvedVia: string }> {
  try {
    const indexRecord = await lookupNandaIndex(agentId, 'nandaindex.org');
    return { indexRecord, resolvedVia: 'nandaindex.org' };
  } catch (err) {
    if (err instanceof NandaIndexError) throw new ResolutionError(err.message, err.code);
    throw err;
  }
}

/** Returns { indexRecord, resolvedVia } for :dnssrv mode. */
async function resolveDnsSrv(agentId: string, namespace: string): Promise<{ indexRecord: IndexRecord; resolvedVia: string }> {
  try {
    const indexRecord = await lookupViaDnsSrv(agentId, namespace);
    return { indexRecord, resolvedVia: `dns-srv:${namespace}` };
  } catch (err) {
    if (err instanceof DnsSrvError) throw new ResolutionError(err.message, err.code);
    throw err;
  }
}

/**
 * Resolves an agent locator to a verified AgentCard (§17.4).
 *
 * Dispatch by mode:
 *   - :global         → NANDA Index at nandaindex.org; falls back to :dnssrv on unreachable (§15.4)
 *   - :nandaindex.org → NANDA Index at nandaindex.org (no fallback — explicit declaration)
 *   - :dnssrv         → DNS SRV _agentindex._tcp.<namespace>
 *
 * @param locator - parsed locator from parseLocator()
 * @returns ResolveResponse with index_record and agent_card
 * @throws ResolutionError
 */
export async function resolveAgent(locator: ParsedLocator): Promise<ResolveResponse> {
  const { agentId, namespace, mode } = locator;

  const { indexRecord, resolvedVia } = await (
    mode === 'global'          ? resolveGlobal(agentId, namespace) :
    mode === 'nandaindex.org'  ? resolveNandaIndex(agentId)        :
                                 resolveDnsSrv(agentId, namespace)
  );

  // Fetch the AgentCard from card_url (§17.4 step 10)
  const agentCard = await fetchAgentCard(indexRecord.card_url).catch((err: unknown) => {
    if (err instanceof AgentCardError) {
      const code = err.code === 'malformed' ? 'card_malformed' : 'unreachable';
      throw new ResolutionError(err.message, code);
    }
    throw err;
  });

  return {
    locator: `${agentId}:${mode}`,
    resolution_mode: mode,
    resolved_via: resolvedVia,
    index_record: indexRecord,
    agent_card: agentCard,
  };
}