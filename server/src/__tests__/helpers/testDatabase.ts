import dotenv from 'dotenv';

// Tests must never run against the development database: a suite that truncates
// tables would wipe the seeded data developers work with. This derives a sibling
// database (`hrms` -> `hrms_test`) from DATABASE_URL, or honours an explicit
// TEST_DATABASE_URL when one is provided (e.g. in CI).
export function resolveTestDatabaseUrl(): string {
  // globalSetup and setupFiles both run before src/config/env.ts loads .env,
  // so read it here too. dotenv never overwrites an already-set variable.
  dotenv.config();

  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set — cannot resolve a test database.',
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name) {
    throw new Error(`DATABASE_URL has no database name: ${base}`);
  }
  if (name.endsWith('_test')) return base;

  url.pathname = `/${name}_test`;
  return url.toString();
}
