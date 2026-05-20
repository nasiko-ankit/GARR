/**
 * Reads a required env var.
 * Prints FATAL to stderr and exits with code 1 if the variable is
 * missing or blank. Intentional: the server must never bind to a
 * port with incomplete config (CLAUDE.md §332–357).
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    console.error(`FATAL: missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

/**
 * Reads an optional env var, returning `fallback` when unset or blank.
 */
export function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') return fallback;
  return value;
}

/**
 * Parses a string into a positive integer (> 0).
 * FATAL + exit(1) on invalid input — same rationale as requireEnv.
 */
export function parsePositiveInt(key: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(
      `FATAL: env var ${key} must be a positive integer (got "${raw}")`,
    );
    process.exit(1);
  }
  return n;
}

export interface DbConfig {
  readonly url: string;
  readonly maxConnections: number;
}

export interface SigningConfig {
  readonly privateKey: string;
  readonly keyId: string;
}

export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  readonly db: DbConfig;
  readonly signing: SigningConfig;
  /**
   * When true, the registration write path skips DMARC and RAP checks.
   * Demo-only escape hatch so we can register fake registries (Google,
   * Walmart) whose domains do not have real DNS/HTTPS infrastructure.
   * Off by default; enabled via GARR_MOCK_VERIFICATION=true.
   */
  readonly mockVerification: boolean;
}

/**
 * Parses a boolean env var. Treats "true" and "1" (case-insensitive,
 * trimmed) as true; everything else — including unset — as false.
 */
export function parseBool(key: string, raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === '' || v === 'false' || v === '0') return false;
  console.error(
    `FATAL: env var ${key} must be one of: true, false, 1, 0 (got "${raw}")`,
  );
  process.exit(1);
}

/**
 * Builds the fully-typed config object from process.env.
 * Called once at server startup; the return value is the single
 * source of truth for env-driven config. Terminates the process
 * with code 1 if any required variable is missing or invalid.
 */
export function buildConfig(): Config {
  const nodeEnv = optionalEnv('NODE_ENV', 'development');
  const mockVerification = parseBool(
    'GARR_MOCK_VERIFICATION',
    optionalEnv('GARR_MOCK_VERIFICATION', 'false'),
  );

  // Loud warning if mock verification is on in production — we keep the
  // door open for emergency demos but make it noisy enough to spot.
  if (mockVerification && nodeEnv === 'production') {
    console.warn(
      '⚠️  GARR_MOCK_VERIFICATION=true while NODE_ENV=production — ' +
        'DMARC + RAP checks are DISABLED. Demo only; do not leave on.',
    );
  }

  return {
    port: parsePositiveInt('PORT', optionalEnv('PORT', '3000')),
    nodeEnv,
    db: {
      url: requireEnv('DATABASE_URL'),
      maxConnections: parsePositiveInt(
        'DB_MAX_CONNECTIONS',
        optionalEnv('DB_MAX_CONNECTIONS', '10'),
      ),
    },
    signing: {
      privateKey: requireEnv('SIGNING_PRIVATE_KEY'),
      keyId: optionalEnv('SIGNING_KEY_ID', 'garr-dev-unspecified'),
    },
    mockVerification,
  };
}
