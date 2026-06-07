/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface AgentRow {
  id: string;
  agentId: string;
  displayName: string;
  description: string | null;
  cardUrl: string;
  tags: string[];
  ttlSeconds: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

/** Wire shape returned by the Registry Server API. */
export interface AgentRecord {
  agent_id: string;
  display_name: string;
  description: string | null;
  card_url: string;
  tags: string[];
  ttl_seconds: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export function toAgentRecord(row: AgentRow): AgentRecord {
  return {
    agent_id:     row.agentId,
    display_name: row.displayName,
    description:  row.description,
    card_url:     row.cardUrl,
    tags:         row.tags,
    ttl_seconds:  row.ttlSeconds,
    status:       row.status,
    created_at:   row.createdAt.toISOString(),
    updated_at:   row.updatedAt.toISOString(),
  };
}

export const AGENT_RECORD_SCHEMA = {
  type: 'object',
  required: ['agent_id', 'display_name', 'card_url', 'tags', 'ttl_seconds', 'status', 'created_at', 'updated_at'],
  properties: {
    agent_id:     { type: 'string' },
    display_name: { type: 'string' },
    description:  { type: ['string', 'null'] },
    card_url:     { type: 'string' },
    tags:         { type: 'array', items: { type: 'string' } },
    ttl_seconds:  { type: 'number' },
    status:       { type: 'string', enum: ['active', 'inactive'] },
    created_at:   { type: 'string' },
    updated_at:   { type: 'string' },
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
