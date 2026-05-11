import dns from 'node:dns/promises';
import type { SrvRecord } from 'node:dns';
import type { IndexRecord } from '../types/api/resolve.js';
import { lookupNandaIndex, NandaIndexError } from './nandaIndexClient.js';

/** Typed error thrown by lookupViaDnsSrv. */
export class DnsSrvError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'unreachable' | 'bad_request' | 'rate_limited' | 'no_srv_record',
  ) {
    super(message);
    this.name = 'DnsSrvError';
  }
}

/**
 * Resolves an agent via DNS SRV lookup (§17.5).
 *
 * Resolution steps:
 *   1. Query DNS SRV `_agentindex._tcp.<namespace>`
 *   2. Sort records by priority (ascending), then weight (descending) per RFC 2782
 *   3. Query the first reachable host as a conforming NANDA Index (GET /lookup?agent=<agentId>)
 *   4. Return the IndexRecord
 *
 * @param agentId   - "identifier@namespace" without mode suffix
 * @param namespace - the DNS namespace (e.g. "nasiko.com")
 * @returns IndexRecord on success
 * @throws DnsSrvError with code 'no_srv_record' | 'not_found' | 'unreachable' | 'bad_request' | 'rate_limited'
 */
export async function lookupViaDnsSrv(agentId: string, namespace: string): Promise<IndexRecord> {
  const srvName = `_agentindex._tcp.${namespace}`;

  let srvRecords: SrvRecord[];
  try {
    srvRecords = await dns.resolveSrv(srvName);
  } catch {
    throw new DnsSrvError(
      `no DNS SRV record found for "${srvName}" — namespace may not publish an agent index`,
      'no_srv_record',
    );
  }

  if (srvRecords.length === 0) {
    throw new DnsSrvError(
      `DNS SRV "${srvName}" returned no records`,
      'no_srv_record',
    );
  }

  // RFC 2782: sort by priority ascending, then weight descending
  const sorted = [...srvRecords].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });

  // Try each SRV target in priority order; return first success
  let lastError: DnsSrvError | null = null;
  for (const record of sorted) {
    const indexHost = record.port === 443 ? record.name : `${record.name}:${record.port}`;
    try {
      return await lookupNandaIndex(agentId, indexHost);
    } catch (err) {
      if (err instanceof NandaIndexError) {
        // not_found is definitive — the index is reachable but the agent doesn't exist
        if (err.code === 'not_found') {
          throw new DnsSrvError(
            `agent "${agentId}" not found in DNS SRV index at "${indexHost}"`,
            'not_found',
          );
        }
        // unreachable / rate_limited — try next SRV target
        lastError = new DnsSrvError(err.message, err.code);
        continue;
      }
      throw err;
    }
  }

  // All SRV targets failed
  throw lastError ?? new DnsSrvError(
    `all DNS SRV targets for "${srvName}" are unreachable`,
    'unreachable',
  );
}