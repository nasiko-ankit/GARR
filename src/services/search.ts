import { searchOrganizations, toIndexRecord } from '../db/queries/organizations.js';
import type { SearchResponse } from '../types/api/search.js';

/**
 * Keyword search across org_id, domain, and display_name.
 * Caller is responsible for validating that rawQuery is at least 2 chars.
 *
 * @param rawQuery - search string (trimmed, ≥ 2 chars)
 */
export async function searchOrgs(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim();
  const rows = await searchOrganizations(query);
  return {
    query,
    count: rows.length,
    results: rows.map(toIndexRecord),
  };
}
