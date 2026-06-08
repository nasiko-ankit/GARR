import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSql } from '../db.js';
import { getConfig } from '../config.js';
import {
  toCatalogEntry,
  CATALOG_ENTRY_SCHEMA,
  CATALOG_DOCUMENT_SCHEMA,
  API_ERROR_SCHEMA,
  type AgentRow,
  type CatalogDocument,
} from '../types.js';

interface CreateAgentBody {
  agent_id: string;
  display_name: string;
  description?: string;
  url: string;
  media_type?: string;
  version?: string;
  tags?: string[];
  ttl_seconds?: number;
}

interface UpdateAgentBody {
  display_name?: string;
  description?: string;
  url?: string;
  media_type?: string;
  version?: string;
  tags?: string[];
  ttl_seconds?: number;
  status?: 'active' | 'inactive';
}

/** Verifies Bearer token matches REGISTRY_ADMIN_TOKEN. */
async function requireAdminToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers['authorization'];
  const config = getConfig();
  if (!auth || auth !== `Bearer ${config.adminToken}`) {
    reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'valid admin token required' });
  }
}

function buildCatalogDocument(rows: AgentRow[]): CatalogDocument {
  return {
    specVersion: '1.0',
    entries: rows.map(toCatalogEntry),
  };
}

/**
 * Registry Server agent routes — serving AI Catalog format (application/ai-catalog+json).
 *
 * Public:
 *   GET /agents                       — catalog document (all active entries)
 *   GET /agents/:agent_id             — single CatalogEntry
 *   GET /.well-known/ai-catalog.json  — same as GET /agents (discovery)
 *
 * Protected (REGISTRY_ADMIN_TOKEN):
 *   POST   /agents            — create entry
 *   PUT    /agents/:agent_id  — update entry
 *   DELETE /agents/:agent_id  — delete entry
 */
export async function registerAgentRoutes(fastify: FastifyInstance): Promise<void> {

  // Well-known discovery endpoint (AI Catalog spec §4.2)
  fastify.get('/.well-known/ai-catalog.json', {
    schema: {
      tags: ['catalog'],
      summary: 'AI Catalog discovery endpoint',
      response: { 200: CATALOG_DOCUMENT_SCHEMA },
    },
  }, async (_request, reply) => {
    const sql = getSql();
    const rows = await sql<AgentRow[]>`
      SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC
    `;
    return reply
      .header('Content-Type', 'application/ai-catalog+json')
      .send(buildCatalogDocument(rows));
  });

  // List active agents as catalog document
  fastify.get('/agents', {
    schema: {
      tags: ['catalog'],
      summary: 'List all active agents as an AI Catalog document',
      response: { 200: CATALOG_DOCUMENT_SCHEMA },
    },
  }, async (_request, reply) => {
    const sql = getSql();
    const rows = await sql<AgentRow[]>`
      SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC
    `;
    return reply.send(buildCatalogDocument(rows));
  });

  // Get single agent as CatalogEntry
  fastify.get<{ Params: { agent_id: string } }>('/agents/:agent_id', {
    schema: {
      tags: ['catalog'],
      summary: 'Get a single agent as a CatalogEntry',
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: { agent_id: { type: 'string' } },
      },
      response: {
        200: CATALOG_ENTRY_SCHEMA,
        404: API_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const sql = getSql();
    const rows = await sql<AgentRow[]>`
      SELECT * FROM agents WHERE agent_id = ${request.params.agent_id} LIMIT 1
    `;
    if (!rows[0]) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `agent "${request.params.agent_id}" not found` });
    }
    return reply.send(toCatalogEntry(rows[0]));
  });

  // Create agent
  fastify.post<{ Body: CreateAgentBody }>('/agents', {
    preHandler: [requireAdminToken],
    schema: {
      tags: ['catalog'],
      summary: 'Register an agent in the catalog',
      body: {
        type: 'object',
        required: ['agent_id', 'display_name', 'url'],
        additionalProperties: false,
        properties: {
          agent_id:     { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', minLength: 1, maxLength: 64 },
          display_name: { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string' },
          url:          { type: 'string', pattern: '^https?://', maxLength: 512 },
          media_type:   { type: 'string', maxLength: 128 },
          version:      { type: 'string', maxLength: 64 },
          tags:         { type: 'array', items: { type: 'string' } },
          ttl_seconds:  { type: 'integer', minimum: 60, maximum: 604800 },
        },
      },
      response: {
        201: CATALOG_ENTRY_SCHEMA,
        409: API_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const sql = getSql();
    const body = request.body;

    try {
      const rows = await sql<AgentRow[]>`
        INSERT INTO agents (agent_id, display_name, description, url, media_type, version, tags, ttl_seconds)
        VALUES (
          ${body.agent_id},
          ${body.display_name},
          ${body.description ?? null},
          ${body.url},
          ${body.media_type ?? 'application/a2a-agent-card+json'},
          ${body.version ?? null},
          ${body.tags ?? []},
          ${body.ttl_seconds ?? 3600}
        )
        RETURNING *
      `;
      return reply.code(201).send(toCatalogEntry(rows[0]!));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'CONFLICT', detail: `agent_id "${body.agent_id}" already exists` });
      }
      throw err;
    }
  });

  // Update agent
  fastify.put<{ Params: { agent_id: string }; Body: UpdateAgentBody }>('/agents/:agent_id', {
    preHandler: [requireAdminToken],
    schema: {
      tags: ['catalog'],
      summary: 'Update an agent catalog entry',
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: { agent_id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          display_name: { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string' },
          url:          { type: 'string', pattern: '^https?://', maxLength: 512 },
          media_type:   { type: 'string', maxLength: 128 },
          version:      { type: 'string', maxLength: 64 },
          tags:         { type: 'array', items: { type: 'string' } },
          ttl_seconds:  { type: 'integer', minimum: 60, maximum: 604800 },
          status:       { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      response: {
        200: CATALOG_ENTRY_SCHEMA,
        404: API_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const sql = getSql();
    const body = request.body;

    const rows = await sql<AgentRow[]>`
      UPDATE agents SET
        display_name = COALESCE(${body.display_name ?? null}, display_name),
        description  = COALESCE(${body.description  ?? null}, description),
        url          = COALESCE(${body.url          ?? null}, url),
        media_type   = COALESCE(${body.media_type   ?? null}, media_type),
        version      = COALESCE(${body.version      ?? null}, version),
        tags         = COALESCE(${body.tags ? sql.array(body.tags) : null}, tags),
        ttl_seconds  = COALESCE(${body.ttl_seconds  ?? null}, ttl_seconds),
        status       = COALESCE(${body.status       ?? null}, status),
        updated_at   = NOW()
      WHERE agent_id = ${request.params.agent_id}
      RETURNING *
    `;
    if (!rows[0]) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `agent "${request.params.agent_id}" not found` });
    }
    return reply.send(toCatalogEntry(rows[0]));
  });

  // Delete agent
  fastify.delete<{ Params: { agent_id: string } }>('/agents/:agent_id', {
    preHandler: [requireAdminToken],
    schema: {
      tags: ['catalog'],
      summary: 'Delete an agent from the catalog',
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: { agent_id: { type: 'string' } },
      },
      response: {
        204: { type: 'null' },
        404: API_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const sql = getSql();
    const result = await sql`
      DELETE FROM agents WHERE agent_id = ${request.params.agent_id}
    `;
    if (result.count === 0) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `agent "${request.params.agent_id}" not found` });
    }
    return reply.code(204).send();
  });
}
