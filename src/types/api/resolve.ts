import type { IndexRecord } from './index-record.js';
import type { AgentRecord } from './agent-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';
import { AGENT_RECORD_SCHEMA } from './agent-record.js';

/** The only supported resolution mode (§15.3 — v2 supports :global only). */
export type ResolutionMode = 'global';

export const RESOLUTION_MODES: ResolutionMode[] = ['global'];

/**
 * The three components of an Agent Locator after parsing (§15.1).
 * Raw form: `<identifier>@<namespace>:<mode>`
 */
export interface ParsedLocator {
  readonly identifier: string;
  readonly namespace: string;
  readonly mode: ResolutionMode;
  readonly agentId: string;
}

/**
 * Successful response from GET /api/v1/resolve.
 * Returns the IndexRecord (from NANDA Index) and the AgentRecord (from Registry Server).
 * The caller uses agent_record.card_url to fetch the A2A card and communicate.
 */
export interface ResolveResponse {
  readonly locator: string;
  readonly index_record: IndexRecord;
  readonly agent_record: AgentRecord;
}

export { IndexRecord, AgentRecord };

export const resolveResponseSchema = {
  type: 'object',
  required: ['locator', 'index_record', 'agent_record'],
  properties: {
    locator:      { type: 'string', minLength: 1 },
    index_record: INDEX_RECORD_SCHEMA,
    agent_record: AGENT_RECORD_SCHEMA,
  },
} as const;
