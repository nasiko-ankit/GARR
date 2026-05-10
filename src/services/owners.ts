import { findByOwnerId } from '../db/queries/entityOwners.js';
import type { EntityOwner } from '../types/entityOwner.js';

/**
 * Read-path lookup for a single EntityOwner (§5.2).
 * Never performs DNS or RAP checks — verification is write-time only.
 * Returns null when the owner_id does not exist.
 *
 * TODO v2: add bloom filter check before DB per §5.3
 * TODO v2: add Redis cache layer per §6.2
 */
export async function getOwner(ownerId: string): Promise<EntityOwner | null> {
  return findByOwnerId(ownerId);
}
