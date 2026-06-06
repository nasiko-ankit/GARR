import { searchEntityOwners } from '../db/queries/entityOwners.js';
import { toEntityOwnerWire } from './ownerWire.js';
import type { SearchResponse } from '../types/api/search.js';

/**
 * Keyword search across owner_id, domain, and display_name.
 * Caller is responsible for validating that rawQuery is at least 2 chars
 * after trimming before calling this function.
 *
 * @param rawQuery - search string (trimmed, ≥ 2 chars)
 */
export async function searchOwners(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim();
  const rows = await searchEntityOwners(query);
  return {
    query,
    count: rows.length,
    results: rows.map(toEntityOwnerWire),
  };
}
