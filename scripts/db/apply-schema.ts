import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '@trading/shared';

/** Apply scripts/db/schema.sql without needing a psql binary. */
async function main(): Promise<void> {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('schema applied');
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('schema apply failed:', err instanceof Error ? err.message : err);
    void pool.end();
    process.exit(1);
  });
