import pg from 'pg';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { loadDotenv } from '../src/loadDotenv.js';
import { assertSafeTestDatabase } from './helpers/safety.js';

/** Runs once before all tests: ensure the `*_test` database exists, then apply migrations to it. */
export default async function setup() {
  loadDotenv();
  const { dbName, url } = assertSafeTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.DATABASE_URL,
  );

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      // Identifier comes from our own validated env var and is quoted; CREATE DATABASE cannot be parameterised.
      await admin.query(`create database "${dbName.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const { db, pool } = createDb(url.toString());
  try {
    await runMigrations(db);
  } finally {
    await pool.end();
  }
}
