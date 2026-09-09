#!/bin/sh
# Container startup: bring the schema up to date, optionally seed a fresh
# database, then hand off to the app. Compose gates this on the database
# healthcheck, so Postgres is already accepting connections by the time we run.
set -e

echo "[entrypoint] applying migrations..."
# --schema is explicit because prisma.config.ts is not shipped to the runtime image.
node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma

# Three-way on purpose: 0 empty, 1 populated, 2 check failed. Treating a failed
# check as "populated" would silently skip seeding on a fresh database and leave
# the demo with an empty login screen; treating it as "empty" would point seed.ts
# at a database it would then wipe. Callers below make 2 fatal.
db_is_empty() {
  set +e
  node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.count()
  .then(async (n) => { await prisma.\$disconnect(); process.exit(n === 0 ? 0 : 1); })
  .catch(async (e) => { console.error('[entrypoint] empty check failed:', e.message); process.exit(2); })
"
  CHECK=$?
  set -e
}

# Seed only when asked AND the database is genuinely empty.
#
# DO NOT REMOVE THE EMPTY CHECK. seed.ts opens with deleteMany() across all 11
# models (seed.ts:58-68), so running it against a populated database silently
# destroys everything rather than erroring. On a restart-happy container that
# would wipe the demo mid-defence.
#
# An empty check rather than a first-boot marker file: a marker on the uploads
# volume would go stale if that volume outlived the database volume.
if [ "${SEED_ON_START}" = "true" ]; then
  db_is_empty

  case "$CHECK" in
    0) echo "[entrypoint] empty database detected — seeding demo data..."
       node dist/prisma/seed.js ;;
    1) echo "[entrypoint] database already populated — skipping seed." ;;
    *) echo "[entrypoint] FATAL: could not determine whether the database is empty." >&2
       exit 1 ;;
  esac
fi

# The live instance's way in. With SEED_ON_START=false nothing else creates the HR
# and EMPLOYEE roles, so a fresh database would have no roles and no way to log in.
#
# bootstrap.js never imports seed.ts and contains no delete, so unlike the block
# above it is safe against a populated database on its own. The empty check runs
# anyway: it keeps the log honest about which start actually created the account,
# and a failed probe stays fatal rather than being shrugged off.
#
# Runs after the seed block on purpose. If both flags are true the seed wins, and
# bootstrap then sees a populated database and skips.
if [ "${BOOTSTRAP_ON_START}" = "true" ]; then
  db_is_empty

  case "$CHECK" in
    0) echo "[entrypoint] empty database detected — bootstrapping roles and the first HR account..."
       node dist/prisma/bootstrap.js ;;
    1) echo "[entrypoint] database already populated — skipping bootstrap." ;;
    *) echo "[entrypoint] FATAL: could not determine whether the database is empty." >&2
       exit 1 ;;
  esac
fi

echo "[entrypoint] starting: $*"
exec "$@"
