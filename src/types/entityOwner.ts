export type EntityOwnerStatus = 'active' | 'stale' | 'suspended';
export type SigningAlgorithm = 'rsa-sha256' | 'ed25519';

/**
 * Domain shape of one row in entity_owners (spec §6.1). Field names
 * are the camelCase projection of the snake_case DB columns — the
 * postgres.js client is configured with postgres.camel, so rows come
 * back in this shape directly.
 */
export interface EntityOwner {
  readonly id: string;
  readonly ownerId: string;
  readonly displayName: string;
  readonly domain: string;
  readonly contactEmail: string;
  readonly rapUrl: string;
  readonly rapFallback: string | null;
  readonly algorithm: SigningAlgorithm;
  readonly publicKey: string;
  readonly keyId: string;
  readonly dmarcPolicy: string;
  readonly ttlSeconds: number;
  readonly serial: string;
  readonly status: EntityOwnerStatus;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly signatureValue: string;
  readonly signedBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
