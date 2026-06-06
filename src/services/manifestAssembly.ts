import { buildConfig } from '../config/index.js';
import { findAllActive } from '../db/queries/entityOwners.js';
import { toEntityOwnerWire } from './ownerWire.js';
import { signCanonical } from './signing.js';
import type { GlobalAgentRoot } from '../types/api/manifest.js';

// §9.3 — manifest serial YYYYMMDDNN; v1 uses NN=00 (single daily assembly, no persisted counter)
// TODO v2: persist last-issued serial in Redis to enforce strict monotonicity across manifest refreshes
function manifestSerial(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}00`;
}

/**
 * Assembles and signs the root manifest from all active EntityOwners.
 *
 * Read path only — never performs DNS or RAP checks (§5.2).
 * Serial format: YYYYMMDDNN per §9.3 (NN=00 in v1).
 * TTL: 24 h per spec §14 recommendation.
 *
 * @returns Signed GlobalAgentRoot containing all active EntityOwners
 */
export async function assembleManifest(): Promise<GlobalAgentRoot> {
  const config = buildConfig();
  const owners = await findAllActive();

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 86400 * 1000);

  const unsigned: Omit<GlobalAgentRoot, 'signature_value'> = {
    version: '1.1',
    serial: manifestSerial(),
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    entity_owners: owners.map(toEntityOwnerWire),
    signature_algorithm: 'ed25519',
    signed_by: config.signing.keyId,
  };

  // §4.5 — signCanonical strips signature_value before computing the byte payload
  const signature_value = signCanonical(
    unsigned as Record<string, unknown>,
    config.signing.privateKey,
  );

  return { ...unsigned, signature_value } as GlobalAgentRoot;
}