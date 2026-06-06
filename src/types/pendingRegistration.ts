import type { SigningAlgorithm } from './entityOwner.js';

/**
 * Domain shape of one row in pending_registrations (camelCase, mirrors DB
 * columns via postgres.camel transform). Rows are short-lived — deleted on
 * successful verify or replaced on re-registration.
 */
export interface PendingRegistration {
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
  readonly ttlSeconds: number;
  readonly dmarcPolicy: string;
  readonly challengeNonce: string;
  readonly challengeExpiresAt: Date;
  readonly createdAt: Date;
}
