import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

async function migrate(): Promise<void> {
  const config = getConfig();
  const sql = postgres(config.db.url, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `.catch((err: unknown) => {
      if ((err as { code?: string }).code !== '42P07') throw err;
      console.log(JSON.stringify(err));
    });

    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const applied = await sql`
        SELECT 1 FROM schema_migrations WHERE filename = ${filename}
      `;
      if (applied.length > 0) {
        console.log(`skip ${filename} (already applied)`);
        continue;
      }

      const sqlContent = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(sqlContent);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
      });
      console.log(`applied ${filename}`);
    }

    console.log('migrations done');
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
