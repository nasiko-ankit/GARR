import type { SigningAlgorithm, EntityOwnerStatus } from '../entityOwner.js';

/**
 * Wire-format shape of one EntityOwner — the canonical public projection
 * returned by GET /api/v1/owners/:owner_id, embedded in the manifest, and
 * returned on successful registration.
 *
 * Fields use snake_case (the JSON wire convention).
 * Internal `EntityOwner` (src/types/entityOwner.ts) uses camelCase
 * (matching postgres.camel column projection); routes convert at the boundary.
 */
export interface EntityOwnerWire {
  owner_id: string;
  display_name: string;
  domain: string;
  contact_email: string;
  rap_url: string;
  rap_fallback: string | null;
  algorithm: SigningAlgorithm;
  public_key: string;
  key_id: string;
  ttl_seconds: number;
  serial: string;
  status: EntityOwnerStatus;
  issued_at: string;       // ISO 8601
  expires_at: string;      // ISO 8601
  signature_value: string; // base64
  signed_by: string;
}

export const entityOwnerWireSchema = {
  type: 'object',
  required: [
    'owner_id',
    'display_name',
    'domain',
    'contact_email',
    'rap_url',
    'rap_fallback',
    'algorithm',
    'public_key',
    'key_id',
    'ttl_seconds',
    'serial',
    'status',
    'issued_at',
    'expires_at',
    'signature_value',
    'signed_by',
  ],
  additionalProperties: false,
  properties: {
    owner_id: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 3, maxLength: 64 },
    display_name: { type: 'string', minLength: 1, maxLength: 200 },
    domain: { type: 'string', format: 'hostname', minLength: 4, maxLength: 253 },
    contact_email: { type: 'string', format: 'email', maxLength: 254 },
    rap_url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 },
    rap_fallback: {
      anyOf: [
        { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 },
        { type: 'null' },
      ],
    },
    algorithm: { type: 'string', enum: ['rsa-sha256', 'ed25519'] },
    public_key: { type: 'string', minLength: 1 },
    key_id: { type: 'string', minLength: 1, maxLength: 200 },
    ttl_seconds: { type: 'integer', minimum: 3600, maximum: 604800 },
    serial: { type: 'string', pattern: '^\\d{10}$' }, // YYYYMMDDNN
    status: { type: 'string', enum: ['active', 'stale', 'suspended'] },
    issued_at: { type: 'string', format: 'date-time' },
    expires_at: { type: 'string', format: 'date-time' },
    signature_value: { type: 'string', minLength: 1 },
    signed_by: { type: 'string', minLength: 1 },
  },
} as const;
