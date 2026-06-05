import { createPrivateKey, sign } from 'node:crypto';

/**
 * Canonical JSON per GARR spec §4.5:
 *   - Object keys sorted lexicographically (recursively)
 *   - No whitespace
 *   - UTF-8 encoding
 *   - Arrays preserve insertion order
 *
 * This output is the exact byte sequence that gets signed and verified.
 * Must match GARR's own implementation — cross-implementation contract.
 */
export function canonicalize(value: unknown): string {
  if (value === null)             return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number not allowed');
    return JSON.stringify(value);
  }
  if (typeof value === 'string')  return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(canonicalize).join(',') + ']';
  }
  const obj  = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

/**
 * Signs an AgentCard payload with Ed25519 using the RAP server's private key.
 *
 * Rules:
 *   1. Strip the `signature` field before canonicalizing — a signature must
 *      never sign over itself.
 *   2. Pass `null` as the algorithm parameter — Ed25519 is implicit in the key.
 *      Never pass 'sha256' for Ed25519.
 *
 * @returns base64-encoded signature string
 */
export function signCard(
  card:          Record<string, unknown>,
  privateKeyPem: string,
): string {
  const { signature: _strip, ...payload } = card;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  const key  = createPrivateKey(privateKeyPem);
  return sign(null, data, key).toString('base64');
}
