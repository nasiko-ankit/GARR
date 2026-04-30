import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

/**
 * Generates an OpenAPI 3 spec from the JSON schemas already declared on
 * each route, and serves Swagger UI at /docs.
 *
 * MUST be registered before any route whose schema you want documented —
 * @fastify/swagger snapshots schemas at route-registration time.
 *
 *   /docs        → Swagger UI
 *   /docs/json   → OpenAPI JSON (for codegen)
 *   /docs/yaml   → OpenAPI YAML
 */
export async function registerSwagger(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'GARR — Global Agent Root Registry',
        description:
          'DNS-inspired registry of registries for AI agents. ' +
          'See GARR_Architecture_Spec_v1.1 for the authoritative design.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3000', description: 'local dev' }],
      tags: [
        { name: 'health', description: 'Liveness and readiness probes' },
        { name: 'register', description: 'EntityOwner registration (write path)' },
        { name: 'owners', description: 'EntityOwner read path' },
        { name: 'manifest', description: 'Signed root manifest' },
        { name: 'search', description: 'Keyword search across registries' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      deepLinking: true,
    },
  });
}
