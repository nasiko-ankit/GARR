import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { globalAgentRootSchema } from '../types/api/manifest.js';

/**
 * Root manifest endpoint (CLAUDE.md §5.1 publisher → §5.2 read).
 *
 *   GET /global_agent_root.json  → 200 GlobalAgentRoot
 *
 * v1 stage 1 returns 501. v2 will serve this from CDN with a fall-through
 * to this origin route. Real handler lands when the manifest publisher
 * cron job is implemented.
 */
export async function registerManifestRoute(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get(
    '/global_agent_root.json',
    {
      schema: {
        response: {
          200: globalAgentRootSchema,
          501: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        endpoint: 'GET /global_agent_root.json',
      });
    },
  );
}
