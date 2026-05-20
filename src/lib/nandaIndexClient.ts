import type { IndexRecord } from '../types/api/resolve.js';
import { buildConfig } from '../config/index.js';

/**
 * NANDA Index base URL override, read once at module load from
 * NANDA_INDEX_BASE_URL. When set, replaces the `https://<indexHost>` prefix
 * — used by the demo to point the resolver at the local mock index.
 *
 * Cached as a module-level constant so we do not re-read env on every call.
 */
const NANDA_BASE_URL_OVERRIDE: string | null = buildConfig().nandaIndexBaseUrl;

/** Typed error thrown by lookupNandaIndex — resolution service maps code to HTTP status. */
export class NandaIndexError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'unreachable' | 'bad_request' | 'rate_limited',
  ) {
    super(message);
    this.name = 'NandaIndexError';
  }
}

/**
 * Queries a NANDA Index instance for an IndexRecord (§17.2).
 *
 * Endpoint: `GET https://<indexHost>/lookup?agent=<agentId>`
 *
 * Used by:
 *   - `:global` mode  → indexHost defaults to "nandaindex.org"
 *   - `:nandaindex.org` mode → indexHost = "nandaindex.org" (explicit)
 *
 * @param agentId   - "identifier@namespace" without mode suffix
 * @param indexHost - NANDA Index hostname (default: "nandaindex.org")
 * @returns IndexRecord on success
 * @throws NandaIndexError with code 'not_found' | 'unreachable' | 'bad_request' | 'rate_limited'
 */
export async function lookupNandaIndex(
  agentId: string,
  indexHost = 'nandaindex.org',
): Promise<IndexRecord> {
  // NANDA_INDEX_BASE_URL wins when set — points the demo resolver at the
  // local mock index. Otherwise we hit `https://<indexHost>` per the spec.
  const url = NANDA_BASE_URL_OVERRIDE
    ? `${NANDA_BASE_URL_OVERRIDE}/lookup?agent=${encodeURIComponent(agentId)}`
    : `https://${indexHost}/lookup?agent=${encodeURIComponent(agentId)}`;
  // Error messages should reflect where we actually called, not the
  // spec-default host, when the override is active.
  const displayHost = NANDA_BASE_URL_OVERRIDE ?? indexHost;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // TODO v2: respect Cache-Control max-age from response (§17.2)
    });
  } catch (err) {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} is unreachable: ${(err as Error).message}`,
      'unreachable',
    );
  }

  if (res.status === 404) {
    throw new NandaIndexError(
      `agent "${agentId}" is not registered in NANDA Index at ${displayHost}`,
      'not_found',
    );
  }

  if (res.status === 400) {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} rejected the query for "${agentId}" (400)`,
      'bad_request',
    );
  }

  if (res.status === 429) {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} rate-limited this resolver (429)`,
      'rate_limited',
    );
  }

  if (res.status === 503 || !res.ok) {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} returned ${res.status} for "${agentId}"`,
      'unreachable',
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} returned non-JSON for "${agentId}"`,
      'unreachable',
    );
  }

  // Minimal shape check before returning — full validation happens in the service
  const record = data as Record<string, unknown>;
  if (
    typeof record['agent_id']   !== 'string' ||
    typeof record['agent_name'] !== 'string' ||
    typeof record['card_url']   !== 'string' ||
    typeof record['ttl']        !== 'number' ||
    typeof record['signature']  !== 'string'
  ) {
    throw new NandaIndexError(
      `NANDA Index at ${displayHost} returned a malformed IndexRecord for "${agentId}"`,
      'unreachable',
    );
  }

  return data as IndexRecord;
}