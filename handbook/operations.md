# Operations — setup, running, and shipping

Everything about getting the app running on a laptop and getting it onto the server.

## 1. Prerequisites

| Tool | Version | Why that version |
| --- | --- | --- |
| Node.js | 20+ (`package.json` engines); images and CI use **22** | Anything older lacks APIs the build relies on |
| pnpm | **11.17.0** exactly | The lockfile was written by pnpm 11; pnpm 10 will not reproduce it |
| PostgreSQL | **16** | Matches the image used in dev, CI and production |
| Docker | Compose **v2** (`docker compose`, two words) | The compose files use v2 syntax |

`README.md` still says "pnpm 10+". That is stale — use 11.17.0. Corepack is the easiest way:

```bash
corepack enable && corepack prepare pnpm@11.17.0 --activate
```

---

## 2. Running it locally

### Path A — Docker Compose (recommended)

```bash
git clone <repo> && cd hrms-aisahub
docker compose up
# then open http://localhost:5173
```

That is the whole setup. No local PostgreSQL, no `.env` to write — `docker-compose.yml`
injects every server variable inline. The first boot installs dependencies, runs
`prisma migrate deploy` and seeds the database, which takes several minutes; that is why
the healthcheck allows a 300-second `start_period`. Later starts are quick.

This path uses its own database, entirely separate from any PostgreSQL you have installed
on the machine, so it cannot damage local data.

**Ports are deliberately not the obvious ones:**

| Service | Published on | Instead of | Reason |
| --- | --- | --- | --- |
| Web app | `127.0.0.1:5173` | — | |
| API | `127.0.0.1:5001` | 5000 | macOS AirPlay Receiver squats on `*:5000` and answers 403 |
| PostgreSQL | `127.0.0.1:5433` | 5432 | So it coexists with a Homebrew PostgreSQL |

Everything binds to `127.0.0.1` only, so nothing is exposed to your network.

### Path B — local PostgreSQL + pnpm

Use this when you want a debugger attached or fast `tsx` restarts.

```bash
pnpm install                        # postinstall runs `prisma generate`
cp server/.env.example server/.env  # then set DATABASE_URL and JWT_SECRET
createdb hrms                       # must exist first — migrate will not create it
pnpm prisma:migrate
pnpm prisma:seed
pnpm build

pnpm --filter server start   # API on :5000
pnpm --filter client dev     # web on :5173, proxies /api to the API
```

For iteration, `pnpm --filter server dev` (watch mode) beats `build` + `start`.

Health check: `curl localhost:5000/api/v1/health`.

---

## 3. Environment variables

All server variables are read in exactly one place — `server/src/config/env.ts`. Only two
are mandatory, and the process **throws at startup** if either is missing.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | — | Signing key for login tokens. Generate with `openssl rand -hex 32` |
| `NODE_ENV` | No | `development` | `production` disables the CORS middleware entirely |
| `PORT` | No | `5000` | API listen port |
| `JWT_EXPIRES_IN` | No | `12h` | How long a login lasts |
| `SERVE_CLIENT` | No | `false` | `true` makes the API also serve the built web app. Set in the image; leave unset locally |
| `CLIENT_DIST` | No | `<cwd>/client-dist` | Where the built web app lives |
| `UPLOAD_DIR` | No | `<cwd>/uploads` | Where uploaded files are written |
| `TEST_DATABASE_URL` | No | derived — `hrms` → `hrms_test` | Overrides which database the test suite uses. See [testing.md](testing.md) |

There are no `SMTP_*` variables. Notifications are in-app rows, so the deployment has no
mail configuration and no outbound mail dependency at all.

**Web app:** exactly one variable, `VITE_DEV_API_TARGET` (default `http://localhost:5000`),
and it only configures the *development proxy*. There is no API-URL variable, because the
built app calls relative `/api` paths. That is what allows one origin to serve both halves
in production, which in turn is why production needs no CORS configuration at all.

**Production only** (`.env.docker.example` → `docker-compose.prod.yml`):

| Variable | Required | Notes |
| --- | --- | --- |
| `POSTGRES_USER` | **Yes** | Interpolated into `DATABASE_URL`; unset produces a malformed URL |
| `POSTGRES_PASSWORD` | **Yes** | `openssl rand -hex 32` |
| `POSTGRES_DB` | **Yes** | |
| `SEED_ON_START` | No (default `true`) | Seeds **only if the `User` table is empty** — see §7 |

Never commit a real `.env`. On the server it is created once by hand and CI never
overwrites it.

---

## 4. How the Docker image is built

Five stages, each with a distinct product:

| Stage | Produces |
| --- | --- |
| `base` | node:22-alpine + `openssl` (Prisma's musl engines link against it) + pnpm via corepack |
| `deps` | Full install including dev dependencies — `tsc` and `vite` are build tools |
| `build` | Compiled server (`server/dist`) and built web app (`client/dist`) |
| `prod-deps` | `pnpm deploy --prod`, flattening the symlinked store into a real dependency tree |
| `runtime` | Clean node:22-alpine with no toolchain, no source, no pnpm |

Two non-obvious details that will waste an afternoon if you undo them:

- **`prisma generate` runs three times**, and the last one — in the *runtime* stage — is the
  one that matters. `pnpm deploy` rebuilds `node_modules` from the store's *ungenerated*
  `@prisma/client` stub, discarding anything generated earlier. Remove the runtime
  generate and the container dies at import with *"@prisma/client did not initialize yet"*.
- **`server/prisma` is copied before `pnpm install`**, because `prisma generate` runs as
  the server package's `postinstall` hook and needs the schema present.

The container **runs as a non-root user**, and `prisma.config.ts` is deliberately not
copied into the runtime image (it is TypeScript, and there is no TS loader at runtime), so
the entrypoint passes `--schema` explicitly.

### The entrypoint

On every container start: `prisma migrate deploy` runs unconditionally. Then, if
`SEED_ON_START=true`, it probes whether the database is empty and seeds only if it is. The
probe is three-way on purpose — empty → seed, populated → skip, **check failed → abort the
container**. Neither wrong guess is acceptable: assuming "populated" would leave a fresh
database unseeded, and assuming "empty" would wipe a live one.

### How the web app is served in production

`SERVE_CLIENT=true` is baked into the image. The API then serves the built web app as
static files plus a catch-all route returning `index.html`, registered *after* every
`/api/v1` route so that an unknown API path still returns a JSON 404 rather than a page of
HTML. One origin, one certificate, no CORS.

---

## 5. CI/CD

`.github/workflows/deploy.yml`. Triggers: push to `main`, pull request to `main`, and
manual dispatch.

Runs queue rather than cancel (`cancel-in-progress: false`) — a half-finished image load on
a 1 GB server is worse than waiting.

**`test` job — runs on every push and every PR. This is the merge gate.**

Spins up a PostgreSQL 16 service, then in order: install → `prisma migrate deploy` → seed →
`eslint` → `build` → `test`. Lint runs *without* `--fix`, because CI should report problems
rather than silently rewrite files. Seeding happens before the tests because some API tests
read seeded rows.

**`deploy` job — only on `main`, never on a PR.**

Gated on `test` passing plus `github.ref == 'refs/heads/main'`, so pull requests get the
full test gate with zero production contact. It checks free memory on the server and
**aborts if under 150 MB**, builds the image on the runner for `linux/amd64`, streams it
over SSH, copies the compose file, brings the stack up, and polls both the container
healthcheck and the public URL before declaring success.

Three repository secrets are required:

```bash
gh secret set VPS_SSH_KEY < ~/repos/personal/ssh1.pem
gh secret set VPS_HOST --body <server-ip>
gh secret set VPS_USER --body <server-user>
```

---

## 6. Production deployment

Manual equivalent of the deploy job: `./deploy/deploy.sh` from the repo root (add
`--skip-build` to reuse the last image).

The governing constraint is that **the server has 1 GB of RAM and a history of the kernel
killing processes for using too much.** Two rules follow:

1. **Never build on the server.** Images are built on a laptop or a CI runner and streamed
   in via `docker save | gzip | ssh … docker load`. There is no registry, so there are no
   registry credentials to manage. `docker-compose.prod.yml` has no `build:` key by design.
2. **Every service declares a memory limit**, and both deploy paths refuse to start if the
   server has under 150 MB free — other services share that box.

Always build `--platform linux/amd64`. The server is x86_64; an ARM image built on an Apple
Silicon Mac loads without complaint and then fails to run.

The database container has **no published ports** and sits on an internal network only, so
it is unreachable from the internet. To get a psql prompt you go through the container.

### Rollback

Manual, and **you must prepare it before you deploy**:

```bash
# BEFORE deploying — tag the currently-running image
docker tag hrms-app:deploy hrms-app:previous

# to roll back
docker tag hrms-app:previous hrms-app:deploy && cd ~/hrms && docker compose up -d
```

CI does not do this, so **an automated deploy leaves no rollback point.** It also rolls back
*code only* — a migration applied by the newer image stays applied, and Prisma has no
down-migrations. There are no automated database backups; take a `pg_dump` before any
release that carries a migration.

---

## 7. Common tasks

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install --frozen-lockfile` |
| Apply migrations (dev) | `pnpm prisma:migrate` |
| Apply migrations (non-interactive) | `pnpm --filter server exec prisma migrate deploy --schema=prisma/schema.prisma` |
| Create a migration | `pnpm --filter server exec prisma migrate dev --name <slug>` |
| Seed | `pnpm prisma:seed` — **destructive, see §8** |
| Reset the database (local) | `pnpm --filter server exec prisma migrate reset` |
| Reset the database (Docker) | `docker compose down -v && docker compose up` |
| Regenerate the Prisma client | `pnpm --filter server prisma:generate` |
| Run tests | `pnpm test` |
| Lint and fix | `pnpm lint:fix` |
| Lint as CI does | `pnpm -r exec eslint .` |
| Typecheck / build | `pnpm build` — there is no standalone typecheck script |
| Dev logs | `docker compose logs -f --tail 50 server` |
| Production logs | `ssh <server> 'cd ~/hrms && docker compose logs -f --tail 50 hrms-app'` |
| Restart production app | `ssh <server> 'cd ~/hrms && docker compose restart hrms-app'` |
| Production psql | `ssh <server> 'docker exec -it hrms-db psql -U hrms -d hrms'` |
| Production memory | `ssh <server> 'docker stats --no-stream \| grep hrms'` |
| Manual deploy | `./deploy/deploy.sh` |

Run all `pnpm` commands from the repository root.

---

## 8. Sharp edges

**`pnpm prisma:seed` destroys data.** It opens by deleting every row in all eleven tables,
then recreates the demo set. The README calls it "idempotent", which is true only in the
sense that it converges on the same result — it is a full wipe first. Both container
entrypoints guard it with an emptiness check; the bare `pnpm prisma:seed` command has **no
guard at all**. Never run it against a database whose contents you care about.

**`docker compose down -v` drops the development database volume.** Without `-v` it does not.

**These must already exist or commands fail:**

- `~/hrms/.env` on the server — created once by hand, never written by CI
- the external `web` Docker network (Traefik's)
- DNS resolving to the server, before a certificate can be issued
- the `hrms` database, before `prisma migrate` on the local-PostgreSQL path
- `psql` on your `PATH`, for the test suite's setup step (see [testing.md](testing.md))

**pnpm store corruption on Docker Desktop.** The store is SQLite, and the macOS filesystem
bridge corrupts it — *"database disk image is malformed"*. The compose file puts the store
in a named volume to avoid this. Similarly, host `node_modules` are built for macOS and
cannot execute on Linux, so three named volumes shadow them inside the containers.

**Never run `pnpm deploy --prod` on your own machine.** It writes a production flag into
`.pnpm-workspace-state-v1.json` that makes subsequent installs try to purge dev
dependencies. It is meant to run only inside the image build.

---

## 9. Merging this branch with `main`

This branch and the containerization work on `main` touched several of the same files, but
**the merge is clean — git resolves all of them automatically.** Verified by merging
`origin/main` locally; the result is correct in each case:

| File | Both sides changed it | Merged result |
| --- | --- | --- |
| `server/package.json` | `main` moved `prisma` to `dependencies` | Keeps `main`'s `^6.19.3` in `dependencies` — load-bearing, since `pnpm deploy --prod` must include the Prisma CLI for the entrypoint's `migrate deploy` |
| `server/src/config/env.ts` | `main` added `SERVE_CLIENT`/`CLIENT_DIST`/`UPLOAD_DIR`; this branch removed `ownerEmail` | Both applied |
| `server/.env.example` | `main` listed `OWNER_EMAIL` | Removed |
| `README.md` | `main` added Docker sections; this branch corrected the test and role lines | Both applied |
| `vitest.config.ts` | Only this branch | Test isolation preserved |

The full suite passes on the merged tree (113 tests).

**On the test suite in CI:** the workflow does not install `psql`, which the test setup
shells out to in order to create the test database. It works because the GitHub runner image
already ships PostgreSQL client tools — confirmed by a green CI run on this branch — but it
is an *implicit* dependency. If a future runner image drops them, the failure will point at
`globalSetup`, not at the workflow.

Note also that the CI `DATABASE_URL` carries `?schema=public`, which `psql` rejects outright.
`globalSetup` strips the query string before shelling out, so that path is already handled.
