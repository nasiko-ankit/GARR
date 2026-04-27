/**
 * Shared API primitives used by every endpoint family.
 *
 * `ApiError` is the wire shape every non-2xx response returns
 * (CLAUDE.md §384–407). `OwnerIdParams` is the URL parameter shape
 * for any path containing `:owner_id`.
 */

export interface ApiError {
  error: string;
  detail?: string;
  endpoint?: string;
}

export const apiErrorSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
    detail: { type: 'string' },
    endpoint: { type: 'string' },
  },
} as const;

export interface OwnerIdParams {
  owner_id: string;
}

export const ownerIdParamsSchema = {
  type: 'object',
  required: ['owner_id'],
  additionalProperties: false,
  properties: {
    owner_id: {
      type: 'string',
      pattern: '^[a-z0-9-]+$',
      minLength: 3,
      maxLength: 64,
    },
  },
} as const;
