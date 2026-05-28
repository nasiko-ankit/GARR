import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { indexRecordSchema, agentCardSchema } from '../types/api/resolve.js';
import type { AgentCard } from '../types/api/resolve.js';
import {
  lookupAgent,
  getCard,
  getAgentBySlug,
  addAgent,
  listRegistries,
} from '../mock/seedStore.js';

/**
 * Mock surfaces for the cross-registry demo. NOT mounted in production
 * unless GARR_MOCK_VERIFICATION is also on. See server.ts for the gate.
 *
 *   GET  /mock/nanda/lookup?agent=<id>          → IndexRecord | 404
 *   GET  /mock/registries/:slug/cards/:agent_id → AgentCard   | 404
 *   POST /mock/agents/:slug/invoke              → handshake   | 404
 *
 * The data is seeded from db/seed/*.json by scripts/seed-demo.mjs (STEP 4).
 * Until those files exist every endpoint returns 404 with the ApiError shape.
 */

interface NandaQuery {
  agent: string;
}

interface CardParams {
  slug: string;
  agent_id: string;
}

interface InvokeParams {
  slug: string;
}

interface InvokeBody {
  caller_card: AgentCard;
  callee_agent_id: string;
}

const slugSchema = {
  type: 'string',
  pattern: '^[a-z0-9-]+$',
  minLength: 1,
  maxLength: 64,
} as const;

/**
 * Relaxed copy of agentCardSchema for request-body validation only. The
 * production schema requires `invocation_url` and `card_url` to be
 * `^https://`, which is correct for the spec but blocks our local demo
 * where everything lives on `http://localhost`. The response side keeps
 * the strict schema (fast-json-stringify doesn't pattern-check anyway).
 */
const agentCardInputSchema = {
  type: 'object',
  required: [
    'id',
    'display_name',
    'description',
    'capabilities',
    'invocation_url',
    'protocol',
    'visibility',
    'signature',
  ],
  additionalProperties: true,
  properties: {
    id:             { type: 'string', minLength: 1 },
    display_name:   { type: 'string', minLength: 1 },
    description:    { type: 'string' },
    capabilities:   { type: 'array', items: { type: 'string' } },
    invocation_url: { type: 'string', format: 'uri' },
    protocol:       { type: 'string', minLength: 1 },
    visibility:     { type: 'string', enum: ['public', 'private'] },
    signature:      { type: 'string', minLength: 1 },
  },
} as const;

const handshakeResponseSchema = {
  type: 'object',
  required: ['handshake_ok', 'callee_card', 'echoed_caller_id', 'at'],
  additionalProperties: false,
  properties: {
    handshake_ok: { type: 'boolean' },
    callee_card: agentCardSchema,
    echoed_caller_id: { type: 'string' },
    at: { type: 'string', format: 'date-time' },
  },
} as const;

export async function registerMockRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Mock NANDA Index ───────────────────────────────────────────────────
  fastify.get<{ Querystring: NandaQuery }>(
    '/mock/nanda/lookup',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['agent'],
          additionalProperties: false,
          properties: { agent: { type: 'string', minLength: 1 } },
        },
        response: {
          200: indexRecordSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const record = lookupAgent(request.query.agent);
      if (!record) {
        return reply.status(404).send({
          error: 'not_found',
          detail: `agent "${request.query.agent}" not in mock NANDA Index`,
        });
      }
      return reply.status(200).send(record);
    },
  );

  // ── Mock registry gateway — AgentCard by slug + agent_id ──────────────
  fastify.get<{ Params: CardParams }>(
    '/mock/registries/:slug/cards/:agent_id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug', 'agent_id'],
          additionalProperties: false,
          properties: {
            slug: slugSchema,
            agent_id: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: agentCardSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const card = getCard(request.params.slug, request.params.agent_id);
      if (!card) {
        return reply.status(404).send({
          error: 'not_found',
          detail: `agent "${request.params.agent_id}" not found in registry "${request.params.slug}"`,
        });
      }
      return reply.status(200).send(card);
    },
  );

  // ── A2A invoke stub ───────────────────────────────────────────────────
  fastify.post<{ Params: InvokeParams; Body: InvokeBody }>(
    '/mock/agents/:slug/invoke',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug'],
          additionalProperties: false,
          properties: { slug: slugSchema },
        },
        body: {
          type: 'object',
          required: ['caller_card', 'callee_agent_id'],
          additionalProperties: false,
          properties: {
            caller_card: agentCardInputSchema,
            callee_agent_id: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: handshakeResponseSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const callee = getAgentBySlug(request.params.slug, request.body.callee_agent_id);
      if (!callee) {
        return reply.status(404).send({
          error: 'not_found',
          detail: `callee "${request.body.callee_agent_id}" not found in registry "${request.params.slug}"`,
        });
      }
      return reply.status(200).send({
        handshake_ok: true,
        callee_card: callee,
        echoed_caller_id: request.body.caller_card.id,
        at: new Date().toISOString(),
      });
    },
  );

  // ── Layer 2: list registries (for the UI dropdown) ────────────────────
  fastify.get(
    '/mock/registries',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['registries'],
            additionalProperties: false,
            properties: {
              registries: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['slug', 'owner_id', 'agent_count'],
                  additionalProperties: false,
                  properties: {
                    slug: { type: 'string' },
                    owner_id: { type: 'string' },
                    agent_count: { type: 'integer', minimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => reply.status(200).send({ registries: listRegistries() }),
  );

  // ── Layer 2: agent registration (write side) ──────────────────────────
  fastify.post<{
    Params: { slug: string };
    Body: {
      name: string;
      display_name: string;
      description: string;
      capabilities: string[];
    };
  }>(
    '/mock/registries/:slug/agents',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug'],
          additionalProperties: false,
          properties: { slug: slugSchema },
        },
        body: {
          type: 'object',
          required: ['name', 'display_name', 'description', 'capabilities'],
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              pattern: '^[a-z0-9-]+$',
              minLength: 1,
              maxLength: 64,
            },
            display_name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', minLength: 1, maxLength: 1000 },
            capabilities: {
              type: 'array',
              minItems: 1,
              maxItems: 16,
              items: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
        },
        response: {
          201: {
            type: 'object',
            required: ['agent_id', 'index_record', 'agent_card'],
            additionalProperties: false,
            properties: {
              agent_id: { type: 'string' },
              index_record: indexRecordSchema,
              agent_card: agentCardSchema,
            },
          },
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      // Build the apiBase from the request host so card_url + invocation_url
      // come back pointing at this exact server (works whether you're on
      // localhost:3000 or some other host the demo is deployed to).
      const proto = (request.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
      const host = request.headers.host ?? 'localhost:3000';
      const apiBase = `${proto}://${host}`;

      const result = addAgent(request.params.slug, request.body, apiBase);
      if (!result.ok) {
        const statusByCode: Record<typeof result.error.code, number> = {
          registry_not_found: 404,
          private_key_missing: 500,
          agent_id_conflict: 409,
          persist_failed: 500,
        };
        return reply.status(statusByCode[result.error.code]).send({
          error: result.error.code,
          detail: result.error.detail,
        });
      }

      return reply.status(201).send({
        agent_id: result.agent_id,
        index_record: result.index_record,
        agent_card: result.agent_card,
      });
    },
  );
}