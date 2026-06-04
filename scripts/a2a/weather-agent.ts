/**
 * Weather Agent — port 5001
 *
 * A2A agent that returns real-time weather via wttr.in (no API key needed).
 *
 * Protocol: A2A JSON-RPC 2.0
 * Method:   tasks/send
 * Input:    message.parts[0].text = city name        (e.g. "Tokyo")
 *           message.parts[1].text = target lang code (optional, e.g. "es")
 *                                   When provided, the agent resolves the
 *                                   translator-agent via GARR and calls it
 *                                   to translate the weather result.
 *
 * Start: npm run a2a:weather
 *
 * Weather only:
 *   curl -s -X POST http://localhost:5001/a2a \
 *     -H "Content-Type: application/json" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"id":"t1","message":{"role":"user","parts":[{"type":"text","text":"Tokyo"}]}}}'
 *
 * Weather + translate (agent-to-agent via GARR):
 *   curl -s -X POST http://localhost:5001/a2a \
 *     -H "Content-Type: application/json" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"id":"t1","message":{"role":"user","parts":[{"type":"text","text":"Tokyo"},{"type":"text","text":"es"}]}}}'
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PORT = 5001;
const GARR_BASE = process.env['GARR_URL'] ?? 'http://localhost:3000';
const TRANSLATOR_LOCATOR = 'translator-agent@translatehub.demo:global';

// ── wttr.in response shape (only fields we use) ──────────────────────────────

interface WttrCondition {
  temp_C: string;
  FeelsLikeC: string;
  humidity: string;
  windspeedKmph: string;
  weatherDesc: Array<{ value: string }>;
}

interface WttrResponse {
  current_condition: WttrCondition[];
}

// ── A2A JSON-RPC types ────────────────────────────────────────────────────────

interface A2APart {
  type?: string;
  text?: string;
}

interface A2AMessage {
  role?: string;
  parts?: A2APart[];
}

interface A2AParams {
  id?: string;
  message?: A2AMessage;
}

interface A2ARequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: A2AParams;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function rpcOk(id: string | number, taskId: string, text: string): unknown {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      id: taskId,
      status: { state: 'completed' },
      artifacts: [{ name: 'weather', parts: [{ type: 'text', text }] }],
    },
  };
}

function rpcErr(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── GARR resolution + A2A call ────────────────────────────────────────────────

interface ResolveResponse {
  agent_card: { invocation_url: string };
}

interface A2ATaskResult {
  result?: { artifacts?: Array<{ parts?: Array<{ text?: string }> }> };
  error?: { message?: string };
}

/** Resolve an agent locator via GARR and return its invocation_url. */
async function resolveViaGarr(locator: string): Promise<string> {
  const url = `${GARR_BASE}/api/v1/resolve?locator=${encodeURIComponent(locator)}`;
  console.log(`  → resolving ${locator} via GARR…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GARR resolve failed: HTTP ${res.status}`);
  const data = (await res.json()) as ResolveResponse;
  const invocationUrl = data.agent_card?.invocation_url;
  if (!invocationUrl) throw new Error('GARR returned no invocation_url');
  console.log(`  ✓ resolved to ${invocationUrl}`);
  return invocationUrl;
}

/** Call a remote A2A agent and return its first artifact text. */
async function callA2A(invocationUrl: string, parts: A2APart[]): Promise<string> {
  const body = {
    jsonrpc: '2.0',
    id: `wx-${Date.now()}`,
    method: 'tasks/send',
    params: { id: `task-${Date.now()}`, message: { role: 'user', parts } },
  };
  const res = await fetch(invocationUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`agent call failed: HTTP ${res.status}`);
  const data = (await res.json()) as A2ATaskResult;
  if (data.error) throw new Error(data.error.message ?? 'agent returned error');
  const text = data.result?.artifacts?.[0]?.parts?.[0]?.text;
  if (!text) throw new Error('agent returned no artifact text');
  return text;
}

// ── Weather fetch ─────────────────────────────────────────────────────────────

async function fetchWeather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'GARR-WeatherAgent/1.0' } });
  if (!res.ok) throw new Error(`wttr.in returned HTTP ${res.status}`);

  const data = (await res.json()) as WttrResponse;
  const c = data.current_condition?.[0];
  if (!c) throw new Error('unexpected response shape from wttr.in');

  const desc = c.weatherDesc?.[0]?.value ?? 'unknown';
  return (
    `${city}: ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C), ${desc}. ` +
    `Humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h.`
  );
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' || req.url !== '/a2a') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'use POST /a2a' }));
    return;
  }

  let body: A2ARequest;
  try {
    body = (await readBody(req)) as A2ARequest;
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify(rpcErr(null, -32700, 'Parse error')));
    return;
  }

  if (body.jsonrpc !== '2.0' || body.method !== 'tasks/send') {
    res.writeHead(200);
    res.end(JSON.stringify(rpcErr(body.id ?? null, -32601, 'Method not found — use tasks/send')));
    return;
  }

  const parts = body.params?.message?.parts ?? [];
  const city = parts[0]?.text?.trim() ?? '';
  const targetLang = parts[1]?.text?.trim() ?? '';
  const taskId = body.params?.id ?? 'task-1';

  if (!city) {
    res.writeHead(200);
    res.end(JSON.stringify(rpcErr(body.id, -32602, 'Provide a city in message.parts[0].text')));
    return;
  }

  try {
    const weather = await fetchWeather(city);

    if (!targetLang) {
      res.writeHead(200);
      res.end(JSON.stringify(rpcOk(body.id, taskId, weather)));
      return;
    }

    // Agent-to-agent: resolve translator via GARR, call it with the weather result
    console.log(`  weather fetched, handing off to translator (lang: ${targetLang})…`);
    const translatorUrl = await resolveViaGarr(TRANSLATOR_LOCATOR);
    const translated = await callA2A(translatorUrl, [
      { type: 'text', text: weather },
      { type: 'text', text: targetLang },
    ]);

    res.writeHead(200);
    res.end(JSON.stringify(rpcOk(body.id, taskId, translated)));
  } catch (err) {
    res.writeHead(200);
    res.end(JSON.stringify(rpcErr(body.id, -32603, (err as Error).message)));
  }
});

server.listen(PORT, () => {
  console.log(`\nWeather Agent  http://localhost:${PORT}/a2a`);
  console.log('  protocol : a2a  (JSON-RPC 2.0, method: tasks/send)');
  console.log('  input    : parts[0].text = city name');
  console.log('             parts[1].text = target lang (optional — triggers A2A translation via GARR)');
  console.log(`  GARR     : ${GARR_BASE}\n`);
});
