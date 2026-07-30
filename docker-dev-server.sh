#!/bin/sh
# Startup for the LOCAL DEV server container (docker-compose.yml).
#
# Installs the workspace, applies migrations, seeds a fresh database, then hands
# off to tsx watch. This is the ONLY dev container that installs — the client
# shares these node_modules volumes and waits on this service's healthcheck.
set -e

cd /app

# --store-dir keeps pnpm's SQLite store off the bind mount. On Docker Desktop the
# default (/app/.pnpm-store) lands on virtiofs, where SQLite reliably corrupts
# itself with "database disk image is malformed".
echo "[dev] installing workspace..."
pnpm install --frozen-lockfile --store-dir /pnpm-store

echo "[dev] applying migrations..."
pnpm --filter server exec prisma migrate deploy --schema=prisma/schema.prisma

# Seed only an empty database. seed.ts starts with deleteMany() across all 11
# models, so seeding a populated one would wipe whatever you were working on.
set +e
pnpm --filter server exec node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.count()
  .then(async (n) => { await prisma.\$disconnect(); process.exit(n === 0 ? 0 : 1); })
  .catch((e) => { console.error('[dev] seed check failed:', e.message); process.exit(2); })
"
CHECK=$?
set -e

case "$CHECK" in
  0) echo "[dev] empty database — seeding..."
     pnpm --filter server exec tsx prisma/seed.ts ;;
  1) echo "[dev] database already populated — skipping seed." ;;
  *) echo "[dev] FATAL: could not determine whether the database is empty." >&2
     exit 1 ;;
esac

echo "[dev] starting API with hot reload..."
exec pnpm --filter server dev
