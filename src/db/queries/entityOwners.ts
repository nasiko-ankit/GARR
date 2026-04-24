import type { EntityOwner } from '../../types/entityOwner.js';

/**
 * Look up an EntityOwner by slug (owner_id column). Returns null when
 * no matching row exists.
 *
 * STUB: real SELECT deferred to the registration/search steps. This
 * file establishes the route → service → queries → client contract —
 * all SQL lives under db/queries, nowhere else (CLAUDE.md §361–378).
 */
export async function findByOwnerId(
  ownerId: string,
): Promise<EntityOwner | null> {
  void ownerId;
  return null;
}
