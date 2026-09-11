import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool } from '@trading/shared';

/** Apply scripts/db/schema.sql (fresh installs) without needing a psql binary. */
async function applySchema(): Promise<void> {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('schema applied');
}

/**
 * Run pending files in scripts/db/migrations/ in filename order, tracking
 * applied filenames in schema_migrations so reruns are no-ops. Existing
 * deployed databases get here what fresh installs get from schema.sql.
 */
async function applyMigrations(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = join(process.cwd(), 'scripts', 'db', 'migrations');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    console.log('no migrations directory — skipping');
    return;
  }
  const done = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
  );
  for (const f of files) {
    if (done.has(f)) {
      console.log(`migration ${f}: already applied — skipping`);
      continue;
    }
    const sql = readFileSync(join(dir, f), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await pool.query('COMMIT');
      console.log(`migration ${f}: applied`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
}

async function main(): Promise<void> {
  await applySchema();
  await applyMigrations();
  console.log('done');
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('schema apply failed:', err instanceof Error ? err.message : err);
    void pool.end();
    process.exit(1);
  });
