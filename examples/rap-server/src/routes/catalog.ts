import type { FastifyInstance } from 'fastify';
import { getSql }               from '../db.js';
import { getConfig }            from '../config.js';

interface AgentRow {
  slug:          string;
  displayName:   string;
  description:   string;
  version:       string;
  capabilities:  string[];
  invocationUrl: string;
  protocol:      string;
  visibility:    string;
  signedBy:      string;
  signature:     string;
  createdAt:     Date;
  updatedAt:     Date;
}

function toWire(row: AgentRow, domain: string) {
  return {
    id:             `${row.slug}@${domain}`,
    display_name:   row.displayName,
    description:    row.description,
    version:        row.version,
    capabilities:   row.capabilities,
    invocation_url: row.invocationUrl,
    protocol:       row.protocol,
    visibility:     row.visibility,
    signed_by:      row.signedBy,
    created_at:     row.createdAt,
    updated_at:     row.updatedAt,
    signature:      row.signature,
  };
}

export async function registerCatalogRoute(app: FastifyInstance): Promise<void> {
  // HEAD /agents.json — GARR reachability probe during org registration
  app.head('/agents.json', async (_req, reply) => {
    reply.header('Content-Type', 'application/json');
    return reply.status(200).send();
  });

  // GET /agents.json — full catalog
  // Unauthenticated callers see public agents only.
  // Admin key in Authorization header returns all agents including private.
  app.get('/agents.json', async (req, reply) => {
    const sql     = getSql();
    const cfg     = getConfig();
    const isAdmin = (req.headers['authorization'] as string | undefined)
      ?.includes(cfg.adminApiKey) ?? false;

    const rows = isAdmin
      ? await sql<AgentRow[]>`SELECT * FROM agents ORDER BY created_at ASC`
      : await sql<AgentRow[]>`SELECT * FROM agents WHERE visibility = 'public' ORDER BY created_at ASC`;

    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return reply.send({
      owner_id:        cfg.rapDomain.split('.')[0],
      domain:          cfg.rapDomain,
      generated_at:    new Date().toISOString(),
      catalog_version: 1,
      total:           rows.length,
      agents:          rows.map(r => toWire(r, cfg.rapDomain)),
    });
  });
}
