import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { indexRecordSchema, agentCardSchema } from '../types/api/resolve.js';
import type { AgentCard } from '../types/api/resolve.js';
import { lookupAgent, getCard, getAgentBySlug } from '../mock/seedStore.js';

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
            caller_card: agentCardSchema,
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
}