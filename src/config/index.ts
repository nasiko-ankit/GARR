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
}

/**
 * Builds the fully-typed config object from process.env.
 * Called once at server startup; the return value is the single
 * source of truth for env-driven config. Terminates the process
 * with code 1 if any required variable is missing or invalid.
 */
export function buildConfig(): Config {
  return {
    port: parsePositiveInt('PORT', optionalEnv('PORT', '3000')),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
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
  };
}
