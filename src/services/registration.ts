import { buildConfig } from '../config/index.js';
import { findByOwnerId, findByDomain, insertEntityOwner } from '../db/queries/entityOwners.js';
import { upsertPending, findPending, deletePending } from '../db/queries/pendingRegistrations.js';
import { insertAuditLog } from '../db/queries/auditLog.js';
import { verifyDmarcTxt } from '../lib/dnsVerification.js';
import { headRap } from '../lib/rapVerification.js';
import {
  generateChallengeNonce,
  signCanonical,
  verifySignature,
} from './signing.js';
import type { RegisterRequest, PendingChallengeResponse } from '../types/api/register.js';
import type { EntityOwner } from '../types/entityOwner.js';

/** CHALLENGE_TTL_MS: 15 minutes. Not in spec; working choice surfaced per CLAUDE.md §14. */
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export type RegistrationError = {
  ok: false;
  statusCode: number;
  error: string;
  detail: string;
};

export type InitiateResult = { ok: true; value: PendingChallengeResponse } | RegistrationError;
export type CompleteResult = { ok: true; value: EntityOwner } | RegistrationError;

/** §9.3 — serial format YYYYMMDDNN; 00 is the sequence for first registration. */
function generateSerial(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}00`;
}

/**
 * Write-path step 1: validates the registration request, runs DNS TXT and
 * RAP HEAD checks, issues a key-challenge nonce, and persists the pending
 * registration. Returns a PendingChallengeResponse on success (§5.1).
 *
 * Error codes per §11.1:
 *   409 — owner_id or domain already registered
 *   422 — DMARC TXT missing or RAP endpoint unreachable
 *
 * @param body - validated RegisterRequest from the route handler
 * @param ip   - source IP of the caller (written to audit log on completion)
 */
export async function initiateRegistration(
  body: RegisterRequest,
  ip: string,
): Promise<InitiateResult> {
  // 409 — duplicate owner_id
  const existingById = await findByOwnerId(body.owner_id);
  if (existingById) {
    return {
      ok: false,
      statusCode: 409,
      error: 'conflict',
      detail: `owner_id '${body.owner_id}' is already registered`,
    };
  }

  // 409 — duplicate domain
  const existingByDomain = await findByDomain(body.domain);
  if (existingByDomain) {
    return {
      ok: false,
      statusCode: 409,
      error: 'conflict',
      detail: `domain '${body.domain}' is already registered`,
    };
  }

  // 422 — DMARC TXT verification (§5.1 write pipeline)
  let dmarcPolicy: string;
  try {
    dmarcPolicy = await verifyDmarcTxt(body.domain);
  } catch (err) {
    return {
      ok: false,
      statusCode: 422,
      error: 'dmarc_verification_failed',
      detail: (err as Error).message,
    };
  }

  // 422 — RAP reachability check (§5.1 write pipeline)
  try {
    await headRap(body.rap_url);
  } catch (err) {
    return {
      ok: false,
      statusCode: 422,
      error: 'rap_unreachable',
      detail: (err as Error).message,
    };
  }

  const challengeNonce = generateChallengeNonce();
  const challengeExpiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await upsertPending({
    ownerId: body.owner_id,
    displayName: body.display_name,
    domain: body.domain,
    contactEmail: body.contact_email,
    rapUrl: body.rap_url,
    rapFallback: body.rap_fallback,
    algorithm: body.algorithm,
    publicKey: body.public_key,
    keyId: body.key_id,
    ttlSeconds: body.ttl_seconds ?? 86400,
    dmarcPolicy,
    challengeNonce,
    challengeExpiresAt,
  });

  return {
    ok: true,
    value: {
      owner_id: body.owner_id,
      challenge_nonce: challengeNonce,
      challenge_expires_at: challengeExpiresAt.toISOString(),
      next_step: `/api/v1/register/${body.owner_id}/verify`,
    },
  };

  // ip is captured at initiation for audit purposes but not yet written;
  // the audit log entry lands on completeRegistration.
  void ip;
}

/**
 * Write-path step 2: verifies the registrant's challenge signature, signs
 * the EntityOwner record with the GARR root key, inserts it into
 * entity_owners, writes the audit log, and removes the pending row.
 * Returns the fully-signed EntityOwner on success (§5.1, §9.1, §9.3).
 *
 * Error codes per §11.1:
 *   404 — no pending registration for owner_id
 *   422 — challenge expired or signature invalid
 *
 * @param ownerId            - :owner_id URL param
 * @param challengeSignature - base64 signature of the challenge_nonce
 * @param ip                 - source IP of the caller (written to audit log)
 */
export async function completeRegistration(
  ownerId: string,
  challengeSignature: string,
  ip: string,
): Promise<CompleteResult> {
  // 404 — no pending challenge for this owner_id
  const pending = await findPending(ownerId);
  if (!pending) {
    return {
      ok: false,
      statusCode: 404,
      error: 'not_found',
      detail: `No pending registration found for owner_id '${ownerId}'. Submit POST /api/v1/register first.`,
    };
  }

  // 422 — challenge window expired
  if (new Date() > pending.challengeExpiresAt) {
    return {
      ok: false,
      statusCode: 422,
      error: 'challenge_expired',
      detail: 'Challenge nonce has expired. Submit a new POST /api/v1/register to get a fresh nonce.',
    };
  }

  // 422 — signature invalid (§9.1 key challenge verification)
  const signatureValid = verifySignature(
    pending.challengeNonce,
    challengeSignature,
    pending.publicKey,
    pending.algorithm,
  );
  if (!signatureValid) {
    return {
      ok: false,
      statusCode: 422,
      error: 'signature_invalid',
      detail: 'Challenge signature did not verify against the submitted public_key.',
    };
  }

  const config = buildConfig();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + pending.ttlSeconds * 1000);
  // §9.3 — serial must be strictly greater than the last accepted serial for
  // this owner_id. First registration has no prior serial, so YYYYMMDD00 is valid.
  const serial = generateSerial();

  // §4.5 — sign the canonical wire-shape projection of the EntityOwner record.
  // signCanonical strips signature_value before signing.
  const wirePayload: Record<string, unknown> = {
    owner_id: pending.ownerId,
    display_name: pending.displayName,
    domain: pending.domain,
    contact_email: pending.contactEmail,
    rap_url: pending.rapUrl,
    rap_fallback: pending.rapFallback,
    algorithm: pending.algorithm,
    public_key: pending.publicKey,
    key_id: pending.keyId,
    ttl_seconds: pending.ttlSeconds,
    serial,
    status: 'active',
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    signed_by: config.signing.keyId,
  };

  const signatureValue = signCanonical(wirePayload, config.signing.privateKey);

  const owner = await insertEntityOwner({
    ownerId: pending.ownerId,
    displayName: pending.displayName,
    domain: pending.domain,
    contactEmail: pending.contactEmail,
    rapUrl: pending.rapUrl,
    rapFallback: pending.rapFallback,
    algorithm: pending.algorithm,
    publicKey: pending.publicKey,
    keyId: pending.keyId,
    dmarcPolicy: pending.dmarcPolicy,
    ttlSeconds: pending.ttlSeconds,
    serial,
    issuedAt,
    expiresAt,
    signatureValue,
    signedBy: config.signing.keyId,
  });

  await insertAuditLog({
    ownerId: pending.ownerId,
    action: 'register',
    actor: 'system',
    serialOld: null,
    serialNew: serial,
    ipAddress: ip,
  });

  await deletePending(pending.ownerId);

  return { ok: true, value: owner };
}
