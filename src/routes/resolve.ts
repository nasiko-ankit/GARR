import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { resolveResponseSchema } from '../types/api/resolve.js';
import { parseLocator } from '../lib/locatorParser.js';
import { resolveAgent, ResolutionError } from '../services/resolution.js';

interface ResolveQuerystring {
  locator: string;
}

/**
 * 2-hop agent resolution endpoint.
 *
 *   GET /api/v1/resolve?locator=<identifier>@<namespace>:global
 *
 * Step 1: looks up the org in the NANDA Index DB → IndexRecord (with registry_url)
 * Step 2: fetches the agent from the org's Registry Server → AgentRecord (with card_url)
 *
 * Returns both records. The caller uses agent_record.card_url to reach the A2A card.
 */
export async function registerResolveRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ResolveQuerystring }>('/api/v1/resolve', {
    schema: {
      tags: ['resolve'],
      querystring: {
        type: 'object',
        required: ['locator'],
        additionalProperties: false,
        properties: {
          locator: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: resolveResponseSchema,
        400: apiErrorSchema,
        404: apiErrorSchema,
        502: apiErrorSchema,
        503: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { locator } = request.query;

    let parsed;
    try {
      parsed = parseLocator(locator);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid_locator', detail: (err as Error).message });
    }

    try {
      const result = await resolveAgent(parsed);
      return reply.code(200).send(result);
    } catch (err) {
      if (!(err instanceof ResolutionError)) throw err;

      const statusMap: Record<ResolutionError['code'], number> = {
        not_found:   404,
        bad_request: 400,
        bad_response: 502,
        unreachable: 503,
      };

      return reply.code(statusMap[err.code]).send({ error: err.code, detail: err.message });
    }
  });
}
