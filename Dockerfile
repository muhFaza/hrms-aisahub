# Multi-stage build for the HRMS pnpm workspace.
#
# Produces a single runtime image that serves BOTH the Express API and the built
# React client from one origin (SERVE_CLIENT=true), so Traefik needs only one
# router and the browser needs no CORS.
#
# The VPS has 1GB RAM and must never build this — build on a dev machine and ship
# the image with `deploy/deploy.sh`.

# ---------------------------------------------------------------------------
# base — pnpm + the OpenSSL that Prisma's musl engines link against
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pinned to the version this repo's lockfile was written by.
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — full install (dev deps included; tsc and vite are needed to build)
# ---------------------------------------------------------------------------
FROM base AS deps
# The Prisma tarballs are large (@prisma/client ~27MB, prisma ~17MB) and pnpm's
# 60s default fetch timeout is not enough for them on a slow or congested
# network — CI failed here with "The operation was aborted due to timeout" while
# the same build succeeded locally. These are npm-style config env vars; pnpm 11
# has no --fetch-timeout CLI flag.
ENV npm_config_fetch_timeout=600000
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_maxtimeout=120000

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/
COPY client/package.json client/
# prisma generate runs as server's postinstall and needs the schema present.
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — compile the server (tsc) and the client (vite)
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Re-run generate: `COPY . .` may have replaced the generated client.
RUN pnpm --filter server exec prisma generate --schema=prisma/schema.prisma
RUN pnpm --filter server build && pnpm --filter client build

# ---------------------------------------------------------------------------
# prod-deps — self-contained node_modules with prod dependencies only
#
# `pnpm deploy` resolves the workspace's symlinked store into a real directory
# tree that can be copied into a scratch runtime. Run ONLY here, never on a dev
# machine: it writes a production flag into .pnpm-workspace-state-v1.json that
# makes subsequent host installs try to purge dev dependencies.
# ---------------------------------------------------------------------------
FROM build AS prod-deps
RUN pnpm deploy --legacy --filter=server --prod /prod

# ---------------------------------------------------------------------------
# runtime — no pnpm, no toolchain, no source
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# Serve the SPA from Express and keep uploads on the mounted volume.
ENV SERVE_CLIENT=true
ENV CLIENT_DIST=/app/client-dist
ENV UPLOAD_DIR=/app/uploads
ENV PORT=5000
WORKDIR /app

COPY --from=prod-deps /prod/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./client-dist
# Schema + migrations are needed at runtime for `prisma migrate deploy`.
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/package.json ./package.json

# Generate the Prisma client HERE, not in an earlier stage. `pnpm deploy`
# rebuilds node_modules from the pnpm store, which holds the ungenerated
# @prisma/client stub — anything generated in the build stage is discarded, and
# the app then dies at import with "@prisma/client did not initialize yet".
RUN node_modules/.bin/prisma generate --schema=prisma/schema.prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# prisma.config.ts is deliberately NOT copied: it is TypeScript, and the runtime
# has no TS loader. The entrypoint passes --schema explicitly instead, and the
# container gets its env from compose rather than a .env file.

# Uploads must be writable by the non-root user the base image already provides.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

EXPOSE 5000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
