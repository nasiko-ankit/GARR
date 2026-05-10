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
      dmarc_policy, ttl_seconds, serial, expires_at,
      signature_value, signed_by
    ) VALUES (
      ${data.ownerId}, ${data.displayName}, ${data.domain}, ${data.contactEmail},
      ${data.rapUrl}, ${data.rapFallback ?? null}, ${data.algorithm},
      ${data.publicKey}, ${data.keyId}, ${data.dmarcPolicy},
      ${data.ttlSeconds}, ${data.serial}, ${data.expiresAt},
      ${data.signatureValue}, ${data.signedBy}
    )
    RETURNING *
  `;
  // INSERT RETURNING always yields exactly one row; assert safety here
  return rows[0]!;
}
