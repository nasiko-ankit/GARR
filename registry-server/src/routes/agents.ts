import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSql } from '../db.js';
import { getConfig } from '../config.js';
import { toAgentRecord, AGENT_RECORD_SCHEMA, API_ERROR_SCHEMA, type AgentRow } from '../types.js';

interface CreateAgentBody {
  agent_id: string;
  display_name: string;
  description?: string;
  card_url: string;
  tags?: string[];
  ttl_seconds?: number;
}

interface UpdateAgentBody {
  display_name?: string;
  description?: string;
  card_url?: string;
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

/**
 * Registry Server agent CRUD routes.
 *
 * Public:
 *   GET /agents            — list active agents
 *   GET /agents/:agent_id  — get one agent
 *
 * Protected (REGISTRY_ADMIN_TOKEN):
 *   POST   /agents            — create agent
 *   PUT    /agents/:agent_id  — update agent
 *   DELETE /agents/:agent_id  — delete agent
 */
export async function registerAgentRoutes(fastify: FastifyInstance): Promise<void> {
  // List active agents
  fastify.get('/agents', {
    schema: {
      tags: ['agents'],
      summary: 'List all active agent records',
      response: {
        200: { type: 'array', items: AGENT_RECORD_SCHEMA },
      },
    },
  }, async (_request, reply) => {
    const sql = getSql();
    const rows = await sql<AgentRow[]>`
      SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC
    `;
    return reply.send(rows.map(toAgentRecord));
  });

  // Get single agent
  fastify.get<{ Params: { agent_id: string } }>('/agents/:agent_id', {
    schema: {
      tags: ['agents'],
      summary: 'Get a single agent record',
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: { agent_id: { type: 'string' } },
      },
      response: {
        200: AGENT_RECORD_SCHEMA,
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
    return reply.send(toAgentRecord(rows[0]));
  });

  // Create agent
  fastify.post<{ Body: CreateAgentBody }>('/agents', {
    preHandler: [requireAdminToken],
    schema: {
      tags: ['agents'],
      summary: 'Create an agent record',
      body: {
        type: 'object',
        required: ['agent_id', 'display_name', 'card_url'],
        properties: {
          agent_id:     { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', minLength: 1, maxLength: 64 },
          display_name: { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string' },
          card_url:     { type: 'string', pattern: '^https?://', maxLength: 512 },
          tags:         { type: 'array', items: { type: 'string' } },
          ttl_seconds:  { type: 'integer', minimum: 60, maximum: 604800 },
        },
      },
      response: {
        201: AGENT_RECORD_SCHEMA,
        409: API_ERROR_SCHEMA,
      },
    },
  }, async (request, reply) => {
    const sql = getSql();
    const body = request.body;

    try {
      const rows = await sql<AgentRow[]>`
        INSERT INTO agents (agent_id, display_name, description, card_url, tags, ttl_seconds)
        VALUES (
          ${body.agent_id}, ${body.display_name}, ${body.description ?? null},
          ${body.card_url}, ${body.tags ?? []}, ${body.ttl_seconds ?? 3600}
        )
        RETURNING *
      `;
      return reply.code(201).send(toAgentRecord(rows[0]!));
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
      tags: ['agents'],
      summary: 'Update an agent record',
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
          card_url:     { type: 'string', pattern: '^https?://', maxLength: 512 },
          tags:         { type: 'array', items: { type: 'string' } },
          ttl_seconds:  { type: 'integer', minimum: 60, maximum: 604800 },
          status:       { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      response: {
        200: AGENT_RECORD_SCHEMA,
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
        card_url     = COALESCE(${body.card_url     ?? null}, card_url),
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
    return reply.send(toAgentRecord(rows[0]));
  });

  // Delete agent
  fastify.delete<{ Params: { agent_id: string } }>('/agents/:agent_id', {
    preHandler: [requireAdminToken],
    schema: {
      tags: ['agents'],
      summary: 'Delete an agent record',
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
