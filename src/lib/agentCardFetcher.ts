import type { AgentCard } from '../types/api/resolve.js';

/** Typed error thrown by fetchAgentCard. */
export class AgentCardError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'unreachable' | 'malformed',
  ) {
    super(message);
    this.name = 'AgentCardError';
  }
}

// §3.3 Step 2 — exponential backoff delays in ms: 1s, 2s, 4s (3 retries after initial attempt)
const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches and validates a single AgentCard attempt from `fetchUrl` (no retries).
 * Returns the AgentCard on success.
 * Throws AgentCardError with code 'not_found' | 'unreachable' | 'malformed'.
 */
async function attemptFetch(fetchUrl: string): Promise<AgentCard> {
  let res: Response;
  try {
    res = await fetch(fetchUrl, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new AgentCardError(
      `AgentCard at "${fetchUrl}" is unreachable: ${(err as Error).message}`,
      'unreachable',
    );
  }

  if (res.status === 404) {
    throw new AgentCardError(
      `AgentCard not found at "${fetchUrl}" (404)`,
      'not_found',
    );
  }

  if (!res.ok) {
    throw new AgentCardError(
      `AgentCard fetch failed at "${fetchUrl}" with status ${res.status}`,
      'unreachable',
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new AgentCardError(
      `AgentCard at "${fetchUrl}" returned non-JSON`,
      'malformed',
    );
  }

  const card = data as Record<string, unknown>;
  if (
    typeof card['id']             !== 'string' ||
    typeof card['display_name']   !== 'string' ||
    typeof card['description']    !== 'string' ||
    !Array.isArray(card['capabilities']) ||
    typeof card['invocation_url'] !== 'string' ||
    typeof card['protocol']       !== 'string' ||
    (card['visibility'] !== 'public' && card['visibility'] !== 'private') ||
    typeof card['signature']      !== 'string'
  ) {
    throw new AgentCardError(
      `AgentCard at "${fetchUrl}" is missing required fields`,
      'malformed',
    );
  }

  return data as AgentCard;
}

/**
 * Fetches an AgentCard from `url` with exponential backoff retries (§3.3 Step 2).
 *
 * Retry schedule: initial attempt, then 1s wait, 2s wait, 4s wait (4 attempts total).
 * `not_found` and `malformed` errors are not retried — they are definitive.
 */
async function fetchWithRetry(url: string): Promise<AgentCard> {
  // Strip fragment — the fragment is a hint to the caller, not part of the HTTP request (§16.1)
  const fetchUrl = url.includes('#') ? url.slice(0, url.indexOf('#')) : url;

  let lastError: AgentCardError | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!);

    try {
      return await attemptFetch(fetchUrl);
    } catch (err) {
      if (!(err instanceof AgentCardError)) throw err;
      // not_found and malformed are definitive — stop immediately
      if (err.code !== 'unreachable') throw err;
      lastError = err;
    }
  }

  throw lastError ?? new AgentCardError(
    `AgentCard at "${fetchUrl}" is unreachable after retries`,
    'unreachable',
  );
}

/**
 * Fetches and validates an AgentCard from `cardUrl` (§3.3 Step 2).
 *
 * Retry behaviour:
 *   - Retries up to 3 times on connection errors with backoff (1s, 2s, 4s).
 *   - If primary fails as unreachable and `fallbackUrl` is provided, retries
 *     the same backoff sequence against the fallback.
 *   - `not_found` and `malformed` errors are never retried.
 *   - After all retries on both URLs: throws AgentCardError('unreachable').
 *
 * @param cardUrl     - Primary HTTPS URL; may include a #fragment
 * @param fallbackUrl - Optional fallback URL (from EntityOwner rap_fallback field)
 * @returns AgentCard on success
 * @throws AgentCardError with code 'not_found' | 'unreachable' | 'malformed'
 */
export async function fetchAgentCard(cardUrl: string, fallbackUrl?: string): Promise<AgentCard> {
  try {
    return await fetchWithRetry(cardUrl);
  } catch (primaryErr) {
    if (!(primaryErr instanceof AgentCardError)) throw primaryErr;
    // not_found and malformed: definitive — do not try fallback
    if (primaryErr.code !== 'unreachable' || !fallbackUrl) throw primaryErr;

    // Primary unreachable and fallback provided — §3.3 Step 2 fallback attempt
    try {
      return await fetchWithRetry(fallbackUrl);
    } catch {
      // Surface the primary error so the caller sees the original URL in the message
      throw primaryErr;
    }
  }
}
