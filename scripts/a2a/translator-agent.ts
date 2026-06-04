/**
 * Translator Agent — port 5002
 *
 * A2A agent that translates text via the MyMemory free API (no API key needed).
 *
 * Protocol: A2A JSON-RPC 2.0
 * Method:   tasks/send
 * Input:    message.parts[0].text = text to translate
 *           message.parts[1].text = target language code (optional, default: "es")
 *                                   e.g. "fr", "de", "ja", "zh", "ar"
 * Source language is always English (en).
 *
 * Start: npm run a2a:translator
 * Test:
 *   curl -s -X POST http://localhost:5002/a2a \
 *     -H "Content-Type: application/json" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"id":"t1","message":{"role":"user","parts":[{"type":"text","text":"Hello, how are you?"},{"type":"text","text":"fr"}]}}}'
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PORT = 5002;

// ── MyMemory response shape ───────────────────────────────────────────────────

interface MyMemoryResponse {
  responseStatus: number;
  responseData: { translatedText: string };
  responseMessage?: string;
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
      artifacts: [{ name: 'translation', parts: [{ type: 'text', text }] }],
    },
  };
}

function rpcErr(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Translation fetch ─────────────────────────────────────────────────────────

async function translate(text: string, targetLang: string): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: `en|${targetLang}` });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
  if (!res.ok) throw new Error(`MyMemory returned HTTP ${res.status}`);

  const data = (await res.json()) as MyMemoryResponse;
  if (data.responseStatus !== 200) {
    throw new Error(data.responseMessage ?? 'translation failed');
  }
  return data.responseData.translatedText;
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
  const text = parts[0]?.text?.trim() ?? '';
  const targetLang = parts[1]?.text?.trim() || 'es';
  const taskId = body.params?.id ?? 'task-1';

  if (!text) {
    res.writeHead(200);
    res.end(JSON.stringify(rpcErr(body.id, -32602, 'Provide text in message.parts[0].text')));
    return;
  }

  try {
    const translated = await translate(text, targetLang);
    res.writeHead(200);
    res.end(JSON.stringify(rpcOk(body.id, taskId, `[en→${targetLang}] ${translated}`)));
  } catch (err) {
    res.writeHead(200);
    res.end(JSON.stringify(rpcErr(body.id, -32603, `Translation failed: ${(err as Error).message}`)));
  }
});

server.listen(PORT, () => {
  console.log(`\nTranslator Agent  http://localhost:${PORT}/a2a`);
  console.log('  protocol : a2a  (JSON-RPC 2.0, method: tasks/send)');
  console.log('  input    : parts[0].text = text, parts[1].text = target lang (default: es)');
  console.log('  source   : MyMemory API\n');
});
