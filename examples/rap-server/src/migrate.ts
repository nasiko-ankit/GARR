import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname }             from 'node:path';
import { fileURLToPath }             from 'node:url';
import { getSql }                    from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql<{ filename: string }[]>`SELECT filename FROM _migrations ORDER BY filename`;
  const done    = new Set(applied.map(r => r.filename));

  const migrationsDir = join(__dirname, '../migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (done.has(file)) continue;
    console.log(`  Applying migration: ${file}`);
    const sqlText = readFileSync(join(migrationsDir, file), 'utf8');
    await sql.unsafe(sqlText);
    await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
    console.log(`  ✓ ${file}`);
  }
}

// Runnable directly: npm run migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => { console.log('Migrations complete.'); process.exit(0); })
    .catch(e  => { console.error(e); process.exit(1); });
}
