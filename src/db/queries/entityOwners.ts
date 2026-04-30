// src/db/queries/entityOwners.ts
import type postgres from 'postgres';
import type { EntityOwner } from '../../types/entityOwner.js';

const SEARCH_LIMIT = 20;

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Look up an EntityOwner by slug (owner_id column). Returns null when
 * no matching row exists.
 */
export async function findByOwnerId(
  sql: ReturnType<typeof postgres>,
  ownerId: string,
): Promise<EntityOwner | null> {
  const [row] = await sql<EntityOwner[]>`
    SELECT *
    FROM entity_owners
    WHERE owner_id = ${ownerId}
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Keyword search across owner_id, domain, and display_name.
 *
 * This is intentionally not cached: the spec marks GET /api/v1/search
 * as a live read path with no Redis layer.
 */
export async function searchEntityOwners(
  sql: ReturnType<typeof postgres>,
  rawQuery: string,
  limit = SEARCH_LIMIT,
): Promise<EntityOwner[]> {
  const query = normalizeSearchTerm(rawQuery);
  const escaped = escapeLikePattern(query);
  const prefix = `${escaped}%`;
  const contains = `%${escaped}%`;

  const rows = await sql<EntityOwner[]>`
    SELECT *
    FROM entity_owners
    WHERE
      LOWER(owner_id) LIKE ${contains} ESCAPE '\\'
      OR LOWER(domain) LIKE ${contains} ESCAPE '\\'
      OR LOWER(display_name) LIKE ${contains} ESCAPE '\\'
    ORDER BY
      CASE
        WHEN LOWER(owner_id) = ${query} THEN 0
        WHEN LOWER(domain) = ${query} THEN 1
        WHEN LOWER(owner_id) LIKE ${prefix} ESCAPE '\\' THEN 2
        WHEN LOWER(domain) LIKE ${prefix} ESCAPE '\\' THEN 3
        WHEN LOWER(display_name) LIKE ${prefix} ESCAPE '\\' THEN 4
        ELSE 5
      END,
      display_name ASC,
      owner_id ASC
    LIMIT ${limit}
  `;

  return rows;
}