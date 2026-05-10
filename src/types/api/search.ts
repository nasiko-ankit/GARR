import type { EntityOwnerWire } from './owners.js';
import { entityOwnerWireSchema } from './owners.js';

/**
 * GET /api/v1/search?q=keyword — response envelope.
 * Search is a live read against Postgres; not cached (§5.2 read path).
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
