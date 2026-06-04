export interface Config {
  port:         number;
  nodeEnv:      string;
  dbUrl:        string;
  dbMaxConn:    number;
  signingKey:   string;
  signingKeyId: string;
  rapDomain:    string;
  adminApiKey:  string;
  corsOrigins:  string[];
  rateLimitMax: number;
}

let _config: Config | null = null;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v?.trim()) {
    console.error(`FATAL: missing required env var: ${key}`);
    process.exit(1);
  }
  // Allow \n-escaped PEM values in .env files
  return v.trim().replace(/\\n/g, '\n');
}

function optionalEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return v?.trim() || fallback;
}

function positiveInt(key: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`FATAL: ${key} must be a positive integer, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

/** Singleton — parsed once at first call, then cached. */
export function getConfig(): Config {
  if (_config) return _config;
  _config = {
    port:         positiveInt('PORT', optionalEnv('PORT', '3001')),
    nodeEnv:      optionalEnv('NODE_ENV', 'development'),
    dbUrl:        requireEnv('DATABASE_URL'),
    dbMaxConn:    positiveInt('DB_MAX_CONNECTIONS', optionalEnv('DB_MAX_CONNECTIONS', '10')),
    signingKey:   requireEnv('SIGNING_PRIVATE_KEY'),
    signingKeyId: optionalEnv('SIGNING_KEY_ID', 'rap-key-unset'),
    rapDomain:    requireEnv('RAP_DOMAIN'),
    adminApiKey:  requireEnv('ADMIN_API_KEY'),
    corsOrigins:  optionalEnv('CORS_ORIGINS', '*').split(',').map(s => s.trim()).filter(Boolean),
    rateLimitMax: positiveInt('RATE_LIMIT_MAX', optionalEnv('RATE_LIMIT_MAX', '120')),
  };
  return _config;
}
