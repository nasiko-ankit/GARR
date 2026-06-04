/**
 * Shared signing utilities for the A2A demo RAP servers.
 * canonicalize() must be byte-for-byte identical to src/services/signing.ts
 * so that GARR's verifyAgentCardSignature() accepts cards signed here (§4.5).
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Load the org private key PEM from env.
 * Tries PRIVATE_KEY_FILE (path to downloaded .pem) first, then PRIVATE_KEY_PEM (inline).
 */
export function loadPrivateKey(): string {
  const file = process.env['PRIVATE_KEY_FILE'];
  if (file) {
    const resolved = file.replace(/^~/, process.env['HOME'] ?? '');
    return readFileSync(resolved, 'utf8');
  }
  const pem = process.env['PRIVATE_KEY_PEM'];
  if (pem) return pem.replace(/\\n/g, '\n');
  console.error('FATAL: set PRIVATE_KEY_FILE=path/to/key.pem before starting.');
  process.exit(1);
}

/** Canonical JSON — keys sorted lexicographically, no whitespace (§4.5). */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

/**
 * Signs an AgentCard with an ed25519 private key.
 * Strips the `signature` field before canonicalizing — matches
 * verifyAgentCardSignature() in src/services/signing.ts.
 */
export function signCard(card: Record<string, unknown>, privateKeyPem: string): string {
  const { signature: _sig, ...payload } = card;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  return sign(null, data, createPrivateKey(privateKeyPem)).toString('base64');
}
