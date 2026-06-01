import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { resolveResponseSchema } from '../types/api/resolve.js';
import { parseLocator } from '../lib/locatorParser.js';
import { resolveAgent, ResolutionError } from '../services/resolution.js';

interface ResolveQuerystring {
  locator: string;
}

/**
 * Resolver endpoint (§15–17).
 *
 *   GET /api/v1/resolve?locator=<identifier>@<namespace>:<mode>
 *
 * Dispatches to the correct resolution strategy based on the mode suffix,
 * fetches the AgentCard, and returns both the IndexRecord and AgentCard.
 *
 * Error mapping:
 *   400  invalid / unparseable locator
 *   400  bad_request from NANDA Index
 *   404  not_found | no_srv_record
 *   429  rate_limited
 *   502  card_malformed | signature_invalid
 *   503  unreachable
 */
export async function registerResolveRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ResolveQuerystring }>(
    '/api/v1/resolve',
    {
      schema: {
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
          429: apiErrorSchema,
          502: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { locator } = request.query;

      // Parse locator — §15 format: <identifier>@<namespace>:<mode>
      let parsed;
      try {
        parsed = parseLocator(locator);
      } catch (err) {
        return reply.status(400).send({
          error: 'invalid_locator',
          detail: (err as Error).message,
        });
      }

      try {
        const result = await resolveAgent(parsed);
        return reply.status(200).send(result);
      } catch (err) {
        if (!(err instanceof ResolutionError)) throw err;

        const statusMap: Record<ResolutionError['code'], number> = {
          not_found:        404,
          no_srv_record:    404,
          bad_request:      400,
          rate_limited:     429,
          card_malformed:   502,
          signature_invalid: 502,
          unreachable:      503,
        };

        return reply.status(statusMap[err.code]).send({
          error: err.code,
          detail: err.message,
        });
      }
    },
  );
}