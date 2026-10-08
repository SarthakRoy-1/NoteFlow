/**
 * Guard against running destructive test setup (TRUNCATE) on a real developer database.
 * The test database must be named `*_test` and must differ from DATABASE_URL.
 */
export function assertSafeTestDatabase(testUrl: string | undefined, devUrl: string | undefined) {
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Add it to .env (see README: "Running tests"). ' +
        'Database tests never fall back to DATABASE_URL.',
    );
  }
  const test = new URL(testUrl);
  const dbName = decodeURIComponent(test.pathname.replace(/^\//, ''));
  if (!/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to run tests: database "${dbName}" must have a name ending in "_test".`,
    );
  }
  if (devUrl) {
    const dev = new URL(devUrl);
    const same =
      dev.hostname === test.hostname &&
      (dev.port || '5432') === (test.port || '5432') &&
      dev.pathname === test.pathname;
    if (same)
      throw new Error('TEST_DATABASE_URL must not point at the same database as DATABASE_URL.');
  }
  return { dbName, url: test };
}
