import type { FastifyInstance } from 'fastify';
import { getSql }               from '../db.js';
import { getConfig }            from '../config.js';
import { signCard }             from '../canonical.js';
import { requireAdmin }         from '../middleware/auth.js';

// Slug: lowercase letters, digits, hyphens. Must start and end with alphanumeric.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

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

interface AgentBody {
  name:           string;
  display_name:   string;
  description?:   string;
  version?:       string;
  capabilities:   string[];
  invocation_url: string;
  protocol:       string;
  visibility?:    'public' | 'private';
}

function validate(body: Partial<AgentBody>, nodeEnv: string): string[] {
  const errors: string[] = [];
  if (!SLUG_RE.test(body.name ?? ''))
    errors.push('name: must match /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/ (lowercase, hyphens only)');
  if (!body.display_name?.trim())
    errors.push('display_name: required and must be non-empty');
  if (!Array.isArray(body.capabilities) || body.capabilities.length === 0 ||
      body.capabilities.some(c => typeof c !== 'string'))
    errors.push('capabilities: must be a non-empty string[]');
  const isDevMode = nodeEnv !== 'production';
  const validUrl = body.invocation_url?.startsWith('https://') ||
    (isDevMode && body.invocation_url?.startsWith('http://'));
  if (!validUrl)
    errors.push('invocation_url: must be an HTTPS URL starting with https:// (http:// allowed in dev)');
  if (!['a2a', 'mcp', 'rest', 'https'].includes(body.protocol ?? ''))
    errors.push('protocol: must be one of a2a | mcp | rest | https');
  if (body.visibility && !['public', 'private'].includes(body.visibility))
    errors.push('visibility: must be "public" or "private"');
  return errors;
}

function buildPayload(
  slug:     string,
  body:     AgentBody,
  cfg:      ReturnType<typeof getConfig>,
  existing?: AgentRow,
) {
  const now = new Date().toISOString();
  return {
    id:             `${slug}@${cfg.rapDomain}`,
    display_name:   body.display_name.trim(),
    description:    body.description?.trim() ?? '',
    version:        body.version?.trim() ?? '1.0.0',
    capabilities:   body.capabilities,
    invocation_url: body.invocation_url.trim(),
    protocol:       body.protocol,
    visibility:     body.visibility ?? 'public',
    signed_by:      cfg.signingKeyId,
    created_at:     existing?.createdAt?.toISOString() ?? now,
    updated_at:     now,
  };
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

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  const sql = getSql();
  const cfg = getConfig();

  // ── GET /agents/:slug ───────────────────────────────────────────────────
  // Public agents: no auth required.
  // Private agents: require admin Bearer token.
  app.get<{ Params: { slug: string } }>('/agents/:slug', async (req, reply) => {
    const rows = await sql<AgentRow[]>`
      SELECT * FROM agents WHERE slug = ${req.params.slug}
    `;
    if (!rows[0]) {
      return reply.status(404).send({ error: 'not_found', detail: `Agent '${req.params.slug}' not found` });
    }

    const agent = rows[0];

    if (agent.visibility === 'private') {
      const key = (req.headers['authorization'] as string | undefined)
        ?.replace('Bearer ', '').trim() ?? '';
      if (key !== cfg.adminApiKey) {
        return reply.status(401).send({ error: 'unauthorized', detail: 'This agent is private' });
      }
    }

    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(toWire(agent, cfg.rapDomain));
  });

  // ── POST /agents — register a new agent ────────────────────────────────
  // Requires admin key. Server signs the AgentCard automatically.
  app.post('/agents', { preHandler: requireAdmin }, async (req, reply) => {
    const body   = req.body as Partial<AgentBody>;
    const errors = validate(body, cfg.nodeEnv);
    if (errors.length) {
      return reply.status(422).send({ error: 'validation_failed', details: errors });
    }

    const slug = (body as AgentBody).name;

    // Duplicate check
    const existing = await sql<AgentRow[]>`SELECT slug FROM agents WHERE slug = ${slug}`;
    if (existing[0]) {
      return reply.status(409).send({
        error:  'conflict',
        detail: `Agent '${slug}' already exists. Use PUT /agents/${slug} to update it.`,
      });
    }

    // Build payload, sign, persist
    const payload   = buildPayload(slug, body as AgentBody, cfg);
    const signature = signCard(payload as Record<string, unknown>, cfg.signingKey);

    const [row] = await sql<AgentRow[]>`
      INSERT INTO agents
        (slug, display_name, description, version, capabilities,
         invocation_url, protocol, visibility, signed_by, signature,
         created_at, updated_at)
      VALUES (
        ${slug},
        ${payload.display_name},
        ${payload.description},
        ${payload.version},
        ${payload.capabilities},
        ${payload.invocation_url},
        ${payload.protocol},
        ${payload.visibility},
        ${cfg.signingKeyId},
        ${signature},
        ${payload.created_at},
        ${payload.updated_at}
      )
      RETURNING *
    `;

    await sql`
      INSERT INTO agent_audit (agent_slug, action, actor, ip_address)
      VALUES (${slug}, 'create', ${cfg.signingKeyId}, ${req.ip ?? null})
    `;

    return reply.status(201).send(toWire(row!, cfg.rapDomain));
  });

  // ── PUT /agents/:slug — update an existing agent ───────────────────────
  // Full replacement — all fields must be re-sent. Card is re-signed automatically.
  app.put<{ Params: { slug: string } }>('/agents/:slug', { preHandler: requireAdmin }, async (req, reply) => {
    const { slug } = req.params;
    const body     = req.body as Partial<AgentBody>;

    const [existing] = await sql<AgentRow[]>`SELECT * FROM agents WHERE slug = ${slug}`;
    if (!existing) {
      return reply.status(404).send({ error: 'not_found', detail: `Agent '${slug}' not found` });
    }

    const merged: AgentBody = { ...(body as AgentBody), name: slug };
    const errors = validate(merged, cfg.nodeEnv);
    if (errors.length) {
      return reply.status(422).send({ error: 'validation_failed', details: errors });
    }

    const payload   = buildPayload(slug, merged, cfg, existing);
    const signature = signCard(payload as Record<string, unknown>, cfg.signingKey);

    const [row] = await sql<AgentRow[]>`
      UPDATE agents SET
        display_name   = ${payload.display_name},
        description    = ${payload.description},
        version        = ${payload.version},
        capabilities   = ${payload.capabilities},
        invocation_url = ${payload.invocation_url},
        protocol       = ${payload.protocol},
        visibility     = ${payload.visibility},
        signed_by      = ${cfg.signingKeyId},
        signature      = ${signature},
        updated_at     = ${payload.updated_at}
      WHERE slug = ${slug}
      RETURNING *
    `;

    await sql`
      INSERT INTO agent_audit (agent_slug, action, actor, ip_address)
      VALUES (${slug}, 'update', ${cfg.signingKeyId}, ${req.ip ?? null})
    `;

    return reply.status(200).send(toWire(row!, cfg.rapDomain));
  });

  // ── DELETE /agents/:slug ───────────────────────────────────────────────
  app.delete<{ Params: { slug: string } }>('/agents/:slug', { preHandler: requireAdmin }, async (req, reply) => {
    const { slug } = req.params;
    const result   = await sql`DELETE FROM agents WHERE slug = ${slug} RETURNING slug`;

    if (!result.length) {
      return reply.status(404).send({ error: 'not_found', detail: `Agent '${slug}' not found` });
    }

    await sql`
      INSERT INTO agent_audit (agent_slug, action, actor, ip_address)
      VALUES (${slug}, 'delete', ${cfg.signingKeyId}, ${req.ip ?? null})
    `;

    return reply.status(204).send();
  });
}
