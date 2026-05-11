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

/**
 * Fetches and validates an AgentCard from a card_url (§17.4 step 10).
 *
 * Validates the minimum required shape before returning.
 * Full signature verification is handled by the caller (resolution service).
 *
 * @param cardUrl - HTTPS URL to the AgentCard; may include a #fragment
 * @returns AgentCard on success
 * @throws AgentCardError with code 'not_found' | 'unreachable' | 'malformed'
 */
export async function fetchAgentCard(cardUrl: string): Promise<AgentCard> {
  // Strip fragment — the fragment is a hint to the caller, not part of the HTTP request (§16.1)
  const hashIdx = cardUrl.indexOf('#');
  const fetchUrl = hashIdx === -1 ? cardUrl : cardUrl.slice(0, hashIdx);

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