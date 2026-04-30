// src/types/api/search.ts
import type { EntityOwnerWire } from './owners.js';
import { entityOwnerWireSchema } from './owners.js';

/**
 * GET /api/v1/search?q=keyword
 *
 * The spec requires keyword search across owner_id, domain, and
 * display_name, with a minimum trimmed query length of 2 chars and no
 * cache.
 */
export interface SearchResponse {
  query: string;
  count: number;
  results: EntityOwnerWire[];
}

export const searchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const searchResponseSchema = {
  type: 'object',
  required: ['query', 'count', 'results'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 128 },
    count: { type: 'integer', minimum: 0 },
    results: {
      type: 'array',
      items: entityOwnerWireSchema,
    },
  },
} as const;