/** DB row — camelCase via postgres.camel. */
export interface AgentRow {
  id: string;
  agentId: string;
  displayName: string;
  description: string | null;
  url: string;
  mediaType: string;
  version: string | null;
  tags: string[];
  ttlSeconds: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * AI Catalog CatalogEntry (application/ai-catalog+json §3.2).
 * Required: identifier, displayName, mediaType, url.
 * NANDA-specific fields (ttl_seconds, status) are placed in metadata.
 */
export interface CatalogEntry {
  identifier: string;
  displayName: string;
  mediaType: string;
  url: string;
  description?: string | null;
  tags?: string[];
  version?: string | null;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

/** AI Catalog top-level document (application/ai-catalog+json §3.1). */
export interface CatalogDocument {
  specVersion: string;
  entries: CatalogEntry[];
}

/** Convert a DB row to a spec-compliant CatalogEntry. */
export function toCatalogEntry(row: AgentRow): CatalogEntry {
  return {
    identifier:  row.agentId,
    displayName: row.displayName,
    mediaType:   row.mediaType,
    url:         row.url,
    description: row.description,
    tags:        row.tags,
    version:     row.version,
    updatedAt:   row.updatedAt.toISOString(),
    metadata: {
      ttl_seconds: row.ttlSeconds,
      status:      row.status,
    },
  };
}

export const CATALOG_ENTRY_SCHEMA = {
  type: 'object',
  required: ['identifier', 'displayName', 'mediaType', 'url'],
  properties: {
    identifier:  { type: 'string' },
    displayName: { type: 'string' },
    mediaType:   { type: 'string' },
    url:         { type: 'string' },
    description: { type: ['string', 'null'] },
    tags:        { type: 'array', items: { type: 'string' } },
    version:     { type: ['string', 'null'] },
    updatedAt:   { type: 'string' },
    metadata:    { type: 'object', additionalProperties: true },
  },
} as const;

export const CATALOG_DOCUMENT_SCHEMA = {
  type: 'object',
  required: ['specVersion', 'entries'],
  properties: {
    specVersion: { type: 'string' },
    entries:     { type: 'array', items: CATALOG_ENTRY_SCHEMA },
  },
} as const;

export const API_ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error:  { type: 'string' },
    detail: { type: 'string' },
  },
} as const;
