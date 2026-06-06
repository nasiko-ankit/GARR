import { buildConfig } from '../config/index.js';
import { findByDomain } from '../db/queries/entityOwners.js';
import { toEntityOwnerWire } from './ownerWire.js';
import {
  derivePublicKey,
  verifyCanonical,
  verifyAgentCardSignature,
} from './signing.js';
import type { ParsedLocator, IndexRecord, AgentCard, ResolveResponse } from '../types/api/resolve.js';
import type { EntityOwner } from '../types/entityOwner.js';
import { lookupNandaIndex, NandaIndexError } from '../lib/nandaIndexClient.js';
import { lookupViaDnsSrv, DnsSrvError } from '../lib/dnsSrvResolver.js';
import { fetchAgentCard, AgentCardError } from '../lib/agentCardFetcher.js';

/** Structured error thrown by resolveAgent — route maps code to HTTP status. */
export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'         // 404
      | 'unreachable'       // 503
      | 'bad_request'       // 400
      | 'rate_limited'      // 429
      | 'no_srv_record'     // 404
      | 'card_malformed'    // 502
      | 'signature_invalid', // 502 — §11.1 SIGNATURE_INVALID
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** Maps an AgentCardError to a ResolutionError. */
function wrapCardError(err: AgentCardError): ResolutionError {
  if (err.code === 'malformed') return new ResolutionError(err.message, 'card_malformed');
  if (err.code === 'not_found') return new ResolutionError(err.message, 'not_found');
  return new ResolutionError(err.message, 'unreachable');
}

/**
 * Resolves `:global` mode by querying GARR's own registry (§3.3).
 *
 * Steps:
 *   1. Look up EntityOwner by domain in GARR DB (§3.3 Step 1)
 *   2. Verify root signature on EntityOwner record (§9 — SIGNATURE_INVALID on failure)
 *   3. Construct card URL: rap_url + /agents/ + identifier (§3.3 Step 2)
 *
 * @returns { entityOwner, cardUrl, fallbackCardUrl }
 * @throws ResolutionError with code 'not_found' | 'signature_invalid'
 */
async function resolveGlobal(
  identifier: string,
  namespace: string,
): Promise<{ entityOwner: EntityOwner; cardUrl: string; fallbackCardUrl: string | undefined }> {
  // Step 1 — look up EntityOwner by domain in GARR registry
  const entityOwner = await findByDomain(namespace);
  if (!entityOwner || entityOwner.status !== 'active') {
    throw new ResolutionError(
      `domain "${namespace}" not found in GARR registry`,
      'not_found',
    );
  }

  // Step 2 — verify root signature on EntityOwner record (§9)
  const config = buildConfig();
  const rootPublicKey = derivePublicKey(config.signing.privateKey);
  const wire = toEntityOwnerWire(entityOwner) as unknown as Record<string, unknown>;
  const rootSigValid = verifyCanonical(wire, entityOwner.signatureValue, rootPublicKey, 'ed25519');
  if (!rootSigValid) {
    throw new ResolutionError(
      `root signature invalid for domain "${namespace}" — EntityOwner record may be tampered`,
      'signature_invalid',
    );
  }

  // Step 3 — construct card URL from RAP (§3.3 Step 2)
  const cardUrl = `${entityOwner.rapUrl}/agents/${identifier}`;
  const fallbackCardUrl = entityOwner.rapFallback
    ? `${entityOwner.rapFallback}/agents/${identifier}`
    : undefined;

  return { entityOwner, cardUrl, fallbackCardUrl };
}

/** Returns { indexRecord, resolvedVia } for :nandaindex.org mode (no fallback). */
async function resolveNandaIndex(agentId: string): Promise<{ indexRecord: IndexRecord; resolvedVia: string }> {
  try {
    const indexRecord = await lookupNandaIndex(agentId, 'nandaindex.org');
    return { indexRecord, resolvedVia: 'nandaindex.org' };
  } catch (err) {
    if (err instanceof NandaIndexError) throw new ResolutionError(err.message, err.code);
    throw err;
  }
}

/** Returns { indexRecord, resolvedVia } for :dnssrv mode. */
async function resolveDnsSrv(agentId: string, namespace: string): Promise<{ indexRecord: IndexRecord; resolvedVia: string }> {
  try {
    const indexRecord = await lookupViaDnsSrv(agentId, namespace);
    return { indexRecord, resolvedVia: `dns-srv:${namespace}` };
  } catch (err) {
    if (err instanceof DnsSrvError) throw new ResolutionError(err.message, err.code);
    throw err;
  }
}

/**
 * Resolves an agent locator to a verified AgentCard (§3.3, §3.4, §3.2).
 *
 * `:global` — queries GARR's own DB by domain, verifies root sig, constructs card URL from
 *             RAP, fetches AgentCard with retry backoff (§3.3 Step 2), verifies AgentCard sig
 *             against EntityOwner public key (§3.3 Step 3).
 *
 * `:nandaindex.org` / `:dnssrv` — external index lookup, then fetch AgentCard.
 *   AgentCard signature verification against EntityOwner key requires a GARR DB lookup
 *   for the namespace public key; deferred to v2. // TODO v2: verify AgentCard sig for these modes
 *
 * @param locator - parsed locator from parseLocator()
 * @returns ResolveResponse with index_record and agent_card
 * @throws ResolutionError
 */
export async function resolveAgent(locator: ParsedLocator): Promise<ResolveResponse> {
  const { identifier, namespace, mode, agentId } = locator;

  if (mode === 'global') {
    return resolveViaGlobal(identifier, namespace, agentId);
  }
  return resolveViaIndex(identifier, namespace, mode, agentId);
}

/** :global resolution path — queries GARR DB, verifies sigs, returns verified AgentCard. */
async function resolveViaGlobal(
  identifier: string,
  namespace: string,
  agentId: string,
): Promise<ResolveResponse> {
  // Steps 1–3: DB lookup, root sig verify, card URL construction
  const { entityOwner, cardUrl, fallbackCardUrl } = await resolveGlobal(identifier, namespace);

  // Step 4: fetch AgentCard with retry backoff (1s, 2s, 4s) + fallback URL (§3.3 Step 2)
  let agentCard: AgentCard;
  try {
    agentCard = await fetchAgentCard(cardUrl, fallbackCardUrl);
  } catch (err) {
    if (err instanceof AgentCardError) throw wrapCardError(err);
    throw err;
  }

  // Step 5: verify AgentCard signature against EntityOwner public key (§3.3 Step 3)
  // §2.5 — card was signed with the org's private key; verifying against registered public key
  const cardSigValid = verifyAgentCardSignature(
    agentCard as unknown as Record<string, unknown>,
    agentCard.signature,
    entityOwner.publicKey,
    entityOwner.algorithm,
  );
  if (!cardSigValid) {
    throw new ResolutionError(
      `AgentCard signature invalid for agent "${agentId}" — card may be tampered`,
      'signature_invalid',
    );
  }

  // Synthesize IndexRecord from EntityOwner for response traceability
  const indexRecord: IndexRecord = {
    agent_id: agentId,
    agent_name: entityOwner.displayName,
    card_url: cardUrl,
    ttl: entityOwner.ttlSeconds,
    signature: entityOwner.signatureValue,
  };

  return {
    locator: `${agentId}:global`,
    resolution_mode: 'global',
    resolved_via: 'garr-db',
    index_record: indexRecord,
    agent_card: agentCard,
  };
}

/** :nandaindex.org / :dnssrv resolution path — external index lookup. */
async function resolveViaIndex(
  identifier: string,
  namespace: string,
  mode: 'nandaindex.org' | 'dnssrv',
  agentId: string,
): Promise<ResolveResponse> {
  const { indexRecord, resolvedVia } = await (
    mode === 'nandaindex.org'
      ? resolveNandaIndex(agentId)
      : resolveDnsSrv(agentId, namespace)
  );

  // Fetch AgentCard from card_url in the IndexRecord
  let agentCard: AgentCard;
  try {
    agentCard = await fetchAgentCard(indexRecord.card_url);
  } catch (err) {
    if (err instanceof AgentCardError) throw wrapCardError(err);
    throw err;
  }

  // TODO v2: verify AgentCard signature for :nandaindex.org and :dnssrv modes
  // Requires fetching the EntityOwner's public key from GARR DB by namespace domain.

  return {
    locator: `${agentId}:${mode}`,
    resolution_mode: mode,
    resolved_via: resolvedVia,
    index_record: indexRecord,
    agent_card: agentCard,
  };
}
