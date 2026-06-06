import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { globalAgentRootSchema } from '../types/api/manifest.js';
import { assembleManifest } from '../services/manifestAssembly.js';

/**
 * Root manifest endpoint (§5.2 read path).
 *
 *   GET /global_agent_root.json  → 200 GlobalAgentRoot
 *
 * Assembles the signed manifest on demand from all active EntityOwners.
 * TODO v2: cache in Redis (§6.2) and publish to CDN via manifest publisher cron (§5.1)
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
          503: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const manifest = await assembleManifest();
      return reply.status(200).send(manifest);
    },
  );
}
