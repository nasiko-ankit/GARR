/**
 * Types and JSON schemas for GET /api/v1/resolve?locator=<...>
 * Spec: §15 (locator format), §16 (IndexRecord), §17.4/:global, §17.5/:dnssrv
 */

// ── Resolution mode ──────────────────────────────────────────────────────────

/** The three resolution modes declared by the locator suffix (§15.3). */
export type ResolutionMode = 'global' | 'dnssrv' | 'nandaindex.org';

export const RESOLUTION_MODES: ResolutionMode[] = ['global', 'dnssrv', 'nandaindex.org'];

// ── Parsed locator ───────────────────────────────────────────────────────────

/**
 * The three components of an Agent Locator after parsing (§15.1).
 * Raw form: `<identifier>@<namespace>:<mode>`
 */
export interface ParsedLocator {
  readonly identifier: string;   // e.g. "scheduler"
  readonly namespace: string;    // e.g. "nasiko.com"
  readonly mode: ResolutionMode; // e.g. "global"
  readonly agentId: string;      // identifier@namespace — used as the NANDA Index query key
}

// ── Index Record (§16) ───────────────────────────────────────────────────────

/**
 * Signed pointer returned by a NANDA Index or DNS SRV gateway lookup (§16.1).
 * Sits between GARR root manifest and the AgentCard in the trust chain.
 */
export interface IndexRecord {
  readonly agent_id: string;    // "identifier@namespace"
  readonly agent_name: string;  // human-readable label
  readonly card_url: string;    // HTTPS URL to AgentCard (may include #fragment)
  readonly ttl: number;         // seconds; must not exceed EntityOwner ttl_seconds
  readonly signature: string;   // base64; signed by EntityOwner private key (§16.1)
}

export const indexRecordSchema = {
  type: 'object',
  required: ['agent_id', 'agent_name', 'card_url', 'ttl', 'signature'],
  additionalProperties: false,
  properties: {
    agent_id:   { type: 'string', minLength: 1 },
    agent_name: { type: 'string', minLength: 1 },
    card_url:   { type: 'string', format: 'uri', pattern: '^https://' },
    ttl:        { type: 'integer', minimum: 1 },
    signature:  { type: 'string', minLength: 1 },
  },
} as const;

// ── Agent Card (§16.4) ───────────────────────────────────────────────────────

/**
 * Full agent capability description served by the EntityOwner's RAP endpoint.
 * The resolver fetches this from `card_url` and verifies it before returning (§17.4 step 10).
 *
 * `additionalProperties: true` — orgs may include extra fields beyond the minimum.
 */
export interface AgentCard {
  readonly id: string;                  // "identifier@namespace"
  readonly display_name: string;
  readonly description: string;
  readonly capabilities: string[];      // capability identifiers
  readonly invocation_url: string;      // HTTPS endpoint to invoke the agent
  readonly protocol: string;            // e.g. "https", "a2a", "mcp"
  readonly visibility: 'public' | 'private';
  readonly signature: string;           // base64; signed by EntityOwner private key
  readonly [key: string]: unknown;      // pass-through for org-defined extra fields
}

export const agentCardSchema = {
  type: 'object',
  required: ['id', 'display_name', 'description', 'capabilities', 'invocation_url', 'protocol', 'visibility', 'signature'],
  additionalProperties: true,
  properties: {
    id:             { type: 'string', minLength: 1 },
    display_name:   { type: 'string', minLength: 1 },
    description:    { type: 'string' },
    capabilities:   { type: 'array', items: { type: 'string' } },
    invocation_url: { type: 'string', format: 'uri', pattern: '^https://' },
    protocol:       { type: 'string', minLength: 1 },
    visibility:     { type: 'string', enum: ['public', 'private'] },
    signature:      { type: 'string', minLength: 1 },
  },
} as const;

// ── Resolve response ─────────────────────────────────────────────────────────

/**
 * Successful response from GET /api/v1/resolve.
 * Returns both the IndexRecord (for traceability) and the verified AgentCard.
 */
export interface ResolveResponse {
  readonly locator: string;               // original locator as submitted
  readonly resolution_mode: ResolutionMode;
  readonly resolved_via: string;          // e.g. "nandaindex.org" or "dns-srv:agents.nasiko.com"
  readonly index_record: IndexRecord;
  readonly agent_card: AgentCard;
}

export const resolveResponseSchema = {
  type: 'object',
  required: ['locator', 'resolution_mode', 'resolved_via', 'index_record', 'agent_card'],
  additionalProperties: false,
  properties: {
    locator:          { type: 'string', minLength: 1 },
    resolution_mode:  { type: 'string', enum: ['global', 'dnssrv', 'nandaindex.org'] },
    resolved_via:     { type: 'string', minLength: 1 },
    index_record:     indexRecordSchema,
    agent_card:       agentCardSchema,
  },
} as const;