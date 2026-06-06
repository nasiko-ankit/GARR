import { getSql } from '../client.js';
import type { EntityOwner, SigningAlgorithm } from '../../types/entityOwner.js';

export interface InsertEntityOwnerData {
  ownerId: string;
  displayName: string;
  domain: string;
  contactEmail: string;
  rapUrl: string;
  rapFallback: string | null | undefined;
  algorithm: SigningAlgorithm;
  publicKey: string;
  keyId: string;
  dmarcPolicy: string;
  ttlSeconds: number;
  serial: string;
  // issuedAt must be passed explicitly so the value stored in the DB matches
  // the value that was included in the canonical JSON payload before signing.
  // Letting the DB default to NOW() would create a discrepancy (§4.5).
  issuedAt: Date;
  expiresAt: Date;
  signatureValue: string;
  signedBy: string;
}

/**
 * Look up an EntityOwner by slug. Returns null when no matching row exists.
 */
export async function findByOwnerId(ownerId: string): Promise<EntityOwner | null> {
  const sql = getSql();
  const rows = await sql<EntityOwner[]>`
    SELECT * FROM entity_owners WHERE owner_id = ${ownerId}
  `;
  return rows[0] ?? null;
}

/**
 * Look up an EntityOwner by domain. Used to enforce one-owner-per-domain
 * uniqueness during registration (§9 — domain ownership invariant).
 * Returns null when no matching row exists.
 */
export async function findByDomain(domain: string): Promise<EntityOwner | null> {
  const sql = getSql();
  const rows = await sql<EntityOwner[]>`
    SELECT * FROM entity_owners WHERE domain = ${domain}
  `;
  return rows[0] ?? null;
}

/**
 * Inserts a signed EntityOwner record into the registry. Returns the
 * inserted row (with DB-generated id, issued_at, created_at, updated_at).
 * Throws on unique-constraint violation — callers must check for conflicts
 * before calling this function.
 */
export async function insertEntityOwner(data: InsertEntityOwnerData): Promise<EntityOwner> {
  const sql = getSql();
  const rows = await sql<EntityOwner[]>`
    INSERT INTO entity_owners (
      owner_id, display_name, domain, contact_email,
      rap_url, rap_fallback, algorithm, public_key, key_id,
      dmarc_policy, ttl_seconds, serial, issued_at, expires_at,
      signature_value, signed_by
    ) VALUES (
      ${data.ownerId}, ${data.displayName}, ${data.domain}, ${data.contactEmail},
      ${data.rapUrl}, ${data.rapFallback ?? null}, ${data.algorithm},
      ${data.publicKey}, ${data.keyId}, ${data.dmarcPolicy},
      ${data.ttlSeconds}, ${data.serial}, ${data.issuedAt}, ${data.expiresAt},
      ${data.signatureValue}, ${data.signedBy}
    )
    RETURNING *
  `;
  // INSERT RETURNING always yields exactly one row; assert safety here
  return rows[0]!;
}

/**
 * Returns all EntityOwners with status = 'active', ordered by created_at.
 * Used by the manifest assembler (Step 14) to build global_agent_root.json.
 */
export async function findAllActive(): Promise<EntityOwner[]> {
  const sql = getSql();
  return sql<EntityOwner[]>`
    SELECT * FROM entity_owners WHERE status = 'active' ORDER BY created_at ASC
  `;
}

const SEARCH_LIMIT = 20;

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * Keyword search across owner_id, domain, and display_name.
 * Results are ranked: exact matches first, then prefix matches, then contains.
 * Adapted from the feature/search-module PR with corrected layering (uses
 * getSql() internally rather than accepting the client as a parameter).
 *
 * @param rawQuery - caller-supplied search string (already validated ≥ 2 chars)
 * @param limit    - max rows to return (default 20)
 */
export async function searchEntityOwners(
  rawQuery: string,
  limit = SEARCH_LIMIT,
): Promise<EntityOwner[]> {
  const sql = getSql();
  const query = rawQuery.trim().toLowerCase();
  const escaped = escapeLikePattern(query);
  const prefix = `${escaped}%`;
  const contains = `%${escaped}%`;

  return sql<EntityOwner[]>`
    SELECT *
    FROM entity_owners
    WHERE
      LOWER(owner_id)    LIKE ${contains} ESCAPE '\\'
      OR LOWER(domain)       LIKE ${contains} ESCAPE '\\'
      OR LOWER(display_name) LIKE ${contains} ESCAPE '\\'
    ORDER BY
      CASE
        WHEN LOWER(owner_id)    = ${query}  THEN 0
        WHEN LOWER(domain)      = ${query}  THEN 1
        WHEN LOWER(owner_id)    LIKE ${prefix}   ESCAPE '\\' THEN 2
        WHEN LOWER(domain)      LIKE ${prefix}   ESCAPE '\\' THEN 3
        WHEN LOWER(display_name) LIKE ${prefix}  ESCAPE '\\' THEN 4
        ELSE 5
      END,
      display_name ASC,
      owner_id ASC
    LIMIT ${limit}
  `;
}
