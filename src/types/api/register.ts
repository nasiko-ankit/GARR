import type { SigningAlgorithm } from '../entityOwner.js';
import type { EntityOwnerWire } from './owners.js';
import { entityOwnerWireSchema } from './owners.js';

/**
 * POST /api/v1/register — request body.
 * Caller-supplied EntityOwner fields. Verification + signing fields
 * (serial, signature_value, issued_at, expires_at, signed_by) are
 * generated server-side, not accepted as input.
 */
export interface RegisterRequest {
  owner_id: string;
  display_name: string;
  domain: string;
  contact_email: string;
  rap_url: string;
  rap_fallback?: string | null;
  algorithm: SigningAlgorithm;
  public_key: string;
  key_id: string;
  ttl_seconds?: number;
}

export const registerRequestSchema = {
  type: 'object',
  required: [
    'owner_id',
    'display_name',
    'domain',
    'contact_email',
    'rap_url',
    'algorithm',
    'public_key',
    'key_id',
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
  },
} as const;

/**
 * 202 response from POST /api/v1/register — server has accepted the
 * request and issued a key-challenge nonce. Caller signs the nonce
 * with their private key and submits via POST /verify.
 */
export interface PendingChallengeResponse {
  owner_id: string;
  challenge_nonce: string;       // 32 bytes hex (64 chars)
  challenge_expires_at: string;  // ISO 8601
  next_step: string;             // path: /api/v1/register/:owner_id/verify
}

export const pendingChallengeResponseSchema = {
  type: 'object',
  required: ['owner_id', 'challenge_nonce', 'challenge_expires_at', 'next_step'],
  additionalProperties: false,
  properties: {
    owner_id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    challenge_nonce: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    challenge_expires_at: { type: 'string', format: 'date-time' },
    next_step: { type: 'string' },
  },
} as const;

/**
 * POST /api/v1/register/:owner_id/verify — request body.
 * Caller submits `challenge_signature`: their private-key signature
 * over the nonce returned in PendingChallengeResponse.
 */
export interface VerifyChallengeRequest {
  challenge_signature: string; // base64
}

export const verifyChallengeRequestSchema = {
  type: 'object',
  required: ['challenge_signature'],
  additionalProperties: false,
  properties: {
    challenge_signature: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

/**
 * 201 response from POST /verify — the fully-signed EntityOwner record.
 */
export type RegisteredOwnerResponse = EntityOwnerWire;
export const registeredOwnerResponseSchema = entityOwnerWireSchema;
