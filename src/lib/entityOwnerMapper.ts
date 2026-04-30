// src/lib/entityOwnerMapper.ts
import type { EntityOwner } from '../types/entityOwner.js';
import type { EntityOwnerWire } from '../types/api/owners.js';

/**
 * Converts the internal camelCase DB/domain projection into the public
 * snake_case wire format used by every read API response.
 */
export function toEntityOwnerWire(owner: EntityOwner): EntityOwnerWire {
  return {
    owner_id: owner.ownerId,
    display_name: owner.displayName,
    domain: owner.domain,
    contact_email: owner.contactEmail,
    rap_url: owner.rapUrl,
    rap_fallback: owner.rapFallback,
    algorithm: owner.algorithm,
    public_key: owner.publicKey,
    key_id: owner.keyId,
    ttl_seconds: owner.ttlSeconds,
    serial: owner.serial,
    status: owner.status,
    issued_at: owner.issuedAt.toISOString(),
    expires_at: owner.expiresAt.toISOString(),
    signature_value: owner.signatureValue,
    signed_by: owner.signedBy,
  };
}