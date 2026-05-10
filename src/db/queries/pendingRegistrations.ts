import { getSql } from '../client.js';
import type { PendingRegistration } from '../../types/pendingRegistration.js';
import type { SigningAlgorithm } from '../../types/entityOwner.js';

export interface UpsertPendingData {
  ownerId: string;
  displayName: string;
  domain: string;
  contactEmail: string;
  rapUrl: string;
  rapFallback: string | null | undefined;
  algorithm: SigningAlgorithm;
  publicKey: string;
  keyId: string;
  ttlSeconds: number;
  dmarcPolicy: string;
  challengeNonce: string;
  challengeExpiresAt: Date;
}

/**
 * Inserts a new pending registration challenge. If the owner_id already has
 * an in-flight challenge, replaces it (re-registration resets the nonce).
 * Returns the upserted row.
 */
export async function upsertPending(data: UpsertPendingData): Promise<PendingRegistration> {
  const sql = getSql();
  const rows = await sql<PendingRegistration[]>`
    INSERT INTO pending_registrations (
      owner_id, display_name, domain, contact_email,
      rap_url, rap_fallback, algorithm, public_key, key_id,
      ttl_seconds, dmarc_policy, challenge_nonce, challenge_expires_at
    ) VALUES (
      ${data.ownerId}, ${data.displayName}, ${data.domain}, ${data.contactEmail},
      ${data.rapUrl}, ${data.rapFallback ?? null}, ${data.algorithm},
      ${data.publicKey}, ${data.keyId}, ${data.ttlSeconds},
      ${data.dmarcPolicy}, ${data.challengeNonce}, ${data.challengeExpiresAt}
    )
    ON CONFLICT (owner_id) DO UPDATE SET
      display_name         = EXCLUDED.display_name,
      domain               = EXCLUDED.domain,
      contact_email        = EXCLUDED.contact_email,
      rap_url              = EXCLUDED.rap_url,
      rap_fallback         = EXCLUDED.rap_fallback,
      algorithm            = EXCLUDED.algorithm,
      public_key           = EXCLUDED.public_key,
      key_id               = EXCLUDED.key_id,
      ttl_seconds          = EXCLUDED.ttl_seconds,
      dmarc_policy         = EXCLUDED.dmarc_policy,
      challenge_nonce      = EXCLUDED.challenge_nonce,
      challenge_expires_at = EXCLUDED.challenge_expires_at,
      created_at           = NOW()
    RETURNING *
  `;
  // INSERT RETURNING always yields exactly one row; assert safety here
  return rows[0]!;
}

/**
 * Looks up an in-flight challenge by owner_id. Returns null when none exists.
 */
export async function findPending(ownerId: string): Promise<PendingRegistration | null> {
  const sql = getSql();
  const rows = await sql<PendingRegistration[]>`
    SELECT * FROM pending_registrations WHERE owner_id = ${ownerId}
  `;
  return rows[0] ?? null;
}

/**
 * Deletes the pending challenge for owner_id. Called after a successful verify.
 */
export async function deletePending(ownerId: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM pending_registrations WHERE owner_id = ${ownerId}`;
}
