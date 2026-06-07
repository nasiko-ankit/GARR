function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    console.error(`FATAL: missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') return fallback;
  return value;
}

function parsePositiveInt(key: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`FATAL: ${key} must be a positive integer (got "${raw}")`);
    process.exit(1);
  }
  return n;
}

export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  readonly db: {
    readonly url: string;
    readonly maxConnections: number;
  };
  readonly adminToken: string;
}

let _config: Config | null = null;

/** Returns the config singleton, building it on first call. */
export function getConfig(): Config {
  if (_config) return _config;
  _config = {
    port:    parsePositiveInt('PORT', optionalEnv('PORT', '3002')),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    db: {
      url:            requireEnv('DATABASE_URL'),
      maxConnections: parsePositiveInt('DB_MAX_CONNECTIONS', optionalEnv('DB_MAX_CONNECTIONS', '10')),
    },
    adminToken: requireEnv('REGISTRY_ADMIN_TOKEN'),
  };
  return _config;
}
