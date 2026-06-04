/**
 * RAP server factory.
 *
 * Creates an HTTP Registry Access Point for a demo org.
 * The frontend calls POST /agents to register agents; GARR fetches
 * GET /agents/:slug during resolution to retrieve signed AgentCards.
 *
 * CORS is wide-open so the garr-web frontend can call POST /agents
 * directly from the browser.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadPrivateKey, signCard } from './signing.js';

export interface RapConfig {
  port: number;
  orgId: string;
  domain: string;
  keyId: string;
}

interface SignedCard {
  id: string;
  display_name: string;
  description: string;
  version: string;
  capabilities: string[];
  invocation_url: string;
  protocol: string;
  visibility: 'public';
  signed_by: string;
  created_at: string;
  signature: string;
}

interface RegisterBody {
  name?: unknown;
  display_name?: unknown;
  description?: unknown;
  capabilities?: unknown;
  protocol?: unknown;
  invocation_url?: unknown;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const VALID_PROTOCOLS = new Set(['a2a', 'rest', 'mcp']);

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function startRap(cfg: RapConfig): void {
  const privateKey = loadPrivateKey();
  const catalog = new Map<string, SignedCard>();

  function buildCard(body: RegisterBody): SignedCard | string {
    const name = body.name;
    if (typeof name !== 'string' || !SLUG_RE.test(name))
      return 'name must match ^[a-z0-9-]+$';

    const displayName = body.display_name;
    if (typeof displayName !== 'string' || !displayName)
      return 'display_name is required';

    const description = typeof body.description === 'string' ? body.description : '';

    const caps = body.capabilities;
    if (!Array.isArray(caps) || !caps.every((c) => typeof c === 'string'))
      return 'capabilities must be string[]';

    const protocol = body.protocol;
    if (typeof protocol !== 'string' || !VALID_PROTOCOLS.has(protocol))
      return "protocol must be 'a2a' | 'rest' | 'mcp'";

    // invocation_url is optional — default points to the agent's conventional port
    const invocationUrl =
      typeof body.invocation_url === 'string' && body.invocation_url
        ? body.invocation_url
        : `http://localhost:${cfg.port + 1000}/a2a`;

    const unsigned: Omit<SignedCard, 'signature'> = {
      id: `${name}@${cfg.domain}`,
      display_name: displayName,
      description,
      version: '1.0.0',
      capabilities: caps as string[],
      invocation_url: invocationUrl,
      protocol,
      visibility: 'public',
      signed_by: cfg.keyId,
      created_at: new Date().toISOString(),
    };

    const signature = signCard(unsigned as Record<string, unknown>, privateKey);
    return { ...unsigned, signature };
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    cors(res);
    const method = req.method ?? 'GET';
    const url = (req.url ?? '/').split('?')[0] ?? '/';

    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (method === 'GET' && url === '/agents.json') {
      send(res, 200, {
        owner_id: cfg.orgId,
        domain: cfg.domain,
        generated_at: new Date().toISOString(),
        agents: Array.from(catalog.values()),
      });
      return;
    }

    if (method === 'GET' && url.startsWith('/agents/')) {
      const slug = url.slice('/agents/'.length);
      const card = catalog.get(slug);
      if (!card) { send(res, 404, { error: 'AGENT_NOT_FOUND', slug }); return; }
      send(res, 200, card);
      return;
    }

    if (method === 'POST' && url === '/agents') {
      let body: RegisterBody;
      try { body = (await readBody(req)) as RegisterBody; }
      catch { send(res, 400, { error: 'INVALID_JSON' }); return; }

      const result = buildCard(body);
      if (typeof result === 'string') {
        send(res, 422, { error: 'VALIDATION_FAILED', detail: result });
        return;
      }

      const slug = body.name as string;
      if (catalog.has(slug)) { send(res, 409, { error: 'AGENT_EXISTS', slug }); return; }

      catalog.set(slug, result);
      console.log(`  [${cfg.orgId}] agent registered: ${slug} → ${result.invocation_url}`);
      send(res, 201, result);
      return;
    }

    send(res, 404, { error: 'NOT_FOUND' });
  });

  server.listen(cfg.port, () => {
    console.log(`\n${cfg.orgId} RAP  http://localhost:${cfg.port}`);
    console.log(`  domain : ${cfg.domain}`);
    console.log(`  key_id : ${cfg.keyId}`);
    console.log(`\nRegister this org at the frontend → rap_url: http://localhost:${cfg.port}`);
    console.log('Waiting for agent registrations via POST /agents…\n');
  });
}
