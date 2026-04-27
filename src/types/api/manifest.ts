import type { SigningAlgorithm } from '../entityOwner.js';
import type { EntityOwnerWire } from './owners.js';
import { entityOwnerWireSchema } from './owners.js';

/**
 * GET /global_agent_root.json — the signed root manifest.
 *
 * `entity_owners` is currently an array (current RFC). The spec §14
 * recommends a map keyed by owner_id; the working group has not
 * resolved this. When that decision lands, this shape changes —
 * surface the tradeoff before flipping.
 */
export interface GlobalAgentRoot {
  version: string;             // GARR spec version (e.g. "1.1")
  serial: string;              // YYYYMMDDNN — monotonic per §9
  issued_at: string;           // ISO 8601
  expires_at: string;          // ISO 8601
  entity_owners: EntityOwnerWire[];
  signature_algorithm: SigningAlgorithm;
  signed_by: string;
  signature_value: string;     // base64; signs canonical JSON minus this field
}

export const globalAgentRootSchema = {
  type: 'object',
  required: [
    'version',
    'serial',
    'issued_at',
    'expires_at',
    'entity_owners',
    'signature_algorithm',
    'signed_by',
    'signature_value',
  ],
  additionalProperties: false,
  properties: {
    version: { type: 'string', minLength: 1, maxLength: 16 },
    serial: { type: 'string', pattern: '^\\d{10}$' },
    issued_at: { type: 'string', format: 'date-time' },
    expires_at: { type: 'string', format: 'date-time' },
    entity_owners: {
      type: 'array',
      items: entityOwnerWireSchema,
    },
    signature_algorithm: { type: 'string', enum: ['rsa-sha256', 'ed25519'] },
    signed_by: { type: 'string', minLength: 1 },
    signature_value: { type: 'string', minLength: 1 },
  },
} as const;
