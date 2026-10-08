import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Apply all pending SQL migrations from backend/drizzle. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** CLI entry: `npm run db:migrate -w backend` (uses DATABASE_URL). */
async function main() {
  const { loadDotenv } = await import('../loadDotenv.js');
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  const { db, pool } = createDb(url);
  try {
    await runMigrations(db);
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  });
}
