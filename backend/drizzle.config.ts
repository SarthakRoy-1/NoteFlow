import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // .env is optional here; DATABASE_URL may come from the real environment.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
