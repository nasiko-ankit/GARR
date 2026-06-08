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
  readonly jwt: {
    readonly secret: string;
    readonly expiresIn: string;
  };
}

const DEV_JWT_SECRET = 'registry-dev-secret-change-in-production';
const MIN_JWT_SECRET_LENGTH = 32;

let _config: Config | null = null;

/** Returns the config singleton, building it on first call. */
export function getConfig(): Config {
  if (_config) return _config;

  const nodeEnv   = optionalEnv('NODE_ENV', 'development');
  const jwtSecret = optionalEnv('JWT_SECRET', DEV_JWT_SECRET);

  // Refuse to start in production with a weak or default JWT secret
  if (nodeEnv === 'production') {
    if (jwtSecret === DEV_JWT_SECRET) {
      console.error('FATAL: JWT_SECRET must be set in production — do not use the default dev secret');
      process.exit(1);
    }
    if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      console.error(`FATAL: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`);
      process.exit(1);
    }
  }

  _config = {
    port:    parsePositiveInt('PORT', optionalEnv('PORT', '3002')),
    nodeEnv,
    db: {
      url:            requireEnv('DATABASE_URL'),
      maxConnections: parsePositiveInt('DB_MAX_CONNECTIONS', optionalEnv('DB_MAX_CONNECTIONS', '10')),
    },
    adminToken: requireEnv('REGISTRY_ADMIN_TOKEN'),
    jwt: {
      secret:    jwtSecret,
      expiresIn: optionalEnv('JWT_EXPIRES_IN', '7d'),
    },
  };
  return _config;
}
