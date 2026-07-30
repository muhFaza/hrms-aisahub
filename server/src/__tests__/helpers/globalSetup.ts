import { execFileSync } from 'node:child_process';
import { resolveTestDatabaseUrl } from './testDatabase';

// Runs once before the whole suite: makes sure the test database exists and its
// schema matches prisma/migrations. Individual suites then truncate between tests
// rather than re-migrating, which keeps the per-test cost to a single statement.
export default function setup(): void {
  const testUrl = resolveTestDatabaseUrl();
  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, '');

  createDatabaseIfMissing(url, dbName);

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}

// CREATE DATABASE cannot run inside the target database, so connect to the
// server's default `postgres` database to issue it.
function createDatabaseIfMissing(url: URL, dbName: string): void {
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  try {
    execFileSync('psql', [adminUrl.toString(), '-tAc', `CREATE DATABASE "${dbName}"`], {
      stdio: 'pipe',
    });
  } catch (err) {
    const output = errorOutput(err);
    // Already there: nothing to do. Anything else is worth surfacing, because
    // migrate deploy is about to fail with a much less obvious message.
    if (output.includes('already exists')) return;
    throw new Error(
      `Could not create test database "${dbName}". Create it manually with ` +
        `\`createdb ${dbName}\` and re-run the tests.\n${output}`,
    );
  }
}

function errorOutput(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const { stderr } = err as { stderr?: Buffer | string };
    if (stderr) return stderr.toString();
  }
  return err instanceof Error ? err.message : String(err);
}
