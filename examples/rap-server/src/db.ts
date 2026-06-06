import postgres from 'postgres';
import { getConfig } from './config.js';

let _sql: ReturnType<typeof postgres> | null = null;

/** Singleton postgres connection pool. */
export function getSql() {
  if (_sql) return _sql;
  const cfg = getConfig();
  _sql = postgres(cfg.dbUrl, {
    max:             cfg.dbMaxConn,
    transform:       postgres.camel,
    connect_timeout: 10,
  });
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
