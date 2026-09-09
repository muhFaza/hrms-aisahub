# Deploying HRMS Aisahub

Two deployments on the VPS at `202.74.75.193`, off **one image and one branch**:

| | Demo (thesis) | Live (Aisahub) |
|---|---|---|
| URL | https://hrms.muhammadfaza.com | https://hr.muhammadfaza.com |
| Directory | `/home/fazadev/hrms/` | `/home/fazadev/hrms-live/` |
| Compose file | `docker-compose.demo.yml` | `docker-compose.live.yml` |
| Containers | `hrms-app`, `hrms-db` | `hrms-live-app`, `hrms-live-db` |
| `DEMO_MODE` | `true` (click-to-login list shown) | `false` |
| `SEED_ON_START` | `true` | `false`, hard-coded |
| `BOOTSTRAP_ON_START` | `false` | `true` |
| Data | seeded demo dataset | real payroll |
| Backups | none | nightly, 14 retained |

They differ only in environment and names — nothing in the code knows which one it
is running as. Full rationale in [handbook/operations.md §6](../handbook/operations.md).

⚠️ **The two `.env` files must carry different `JWT_SECRET`s.** Auth trusts only the
`userId` in a token and re-reads the role from the database, so a shared secret makes
a token minted by the demo's `hr@aisahub.com` — whose password is printed on the demo
login page — valid for the same user ID on live. Generate each independently.

## How it works

The VPS has **1GB RAM and an OOM history** — it must never build anything. The
image is built on a dev machine, streamed over SSH with `docker save | docker load`,
and started with Compose. This mirrors how `veydar` and `square-menu-explorer`
already deploy on that box. See `~/CLAUDE.md` on the VPS for the house rules.

One container serves both the API and the built React client, so Traefik needs a
single router and the browser needs no CORS. Postgres runs alongside on a
project-internal network with no published ports.

```
hrms.muhammadfaza.com → Traefik (TLS via certresolver `le`, network `web`)
                          └→ hrms-app :5000        /api/v1/* → Express
                               │                    /*        → client SPA
                               └ hrms-internal → hrms-db (postgres:16-alpine)

hr.muhammadfaza.com   → Traefik
                          └→ hrms-live-app :5000   (same image)
                               └ hrms-live-internal → hrms-live-db
```

## First deploy

1. **DNS** — nothing to do for either host. Both resolve through the wildcard
   `*.muhammadfaza.com` A record already pointing at `202.74.75.193`. Traefik uses
   the HTTP challenge, so this must be true before the cert can issue.

2. **Create the remote env file.** It is not in git and the deploy script refuses
   to run without it. One per directory — `~/hrms/.env` and `~/hrms-live/.env`.

   ```bash
   DIR=hrms-live   # or hrms
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 "mkdir -p ~/$DIR"
   scp -i ~/repos/personal/ssh1.pem .env.docker.example fazadev@202.74.75.193:~/$DIR/.env
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 "chmod 600 ~/$DIR/.env && vi ~/$DIR/.env"
   ```

   Fill in `POSTGRES_PASSWORD` and `JWT_SECRET` with `openssl rand -hex 32` —
   **separately for each file.** For the live instance also set `BOOTSTRAP_HR_EMAIL`
   and `BOOTSTRAP_HR_PASSWORD`: with `SEED_ON_START=false` nothing else creates the
   `HR` and `EMPLOYEE` roles, so without them the first boot leaves a database
   nobody can log into. Once HR has changed the password in-app, delete
   `BOOTSTRAP_HR_PASSWORD` from the file and `docker compose up -d`.

3. **Deploy.**

   ```bash
   ./deploy/deploy.sh                 # demo
   INSTANCE=live ./deploy/deploy.sh   # live
   ```

   It refuses to proceed if the VPS has under 150MB available, builds for
   `linux/amd64`, tags the image already on the box as `hrms-app:previous`, ships the
   new image, syncs that instance's compose file, starts the stack, waits for the
   healthcheck, and curls the public endpoint.

4. **Confirm the certificate issued.**

   ```bash
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 'docker logs traefik --tail 30'
   ```

5. **Add HRMS to the VPS inventory** — append it to the tables in `~/CLAUDE.md`
   on the box, per that file's own checklist.

## Redeploying

Pushing to `main` deploys automatically — see [Continuous deployment](#continuous-deployment).
To deploy by hand (or from an unmerged branch):

```bash
./deploy/deploy.sh                 # demo  → ~/hrms/
INSTANCE=live ./deploy/deploy.sh   # live  → ~/hrms-live/
```

Migrations run automatically on container start. Neither seeding nor bootstrapping
re-runs: the entrypoint probes first and only acts when the `User` table is empty.

## Continuous deployment

`.github/workflows/deploy.yml` runs on every push and PR to `main`.

| Job | When | What |
|---|---|---|
| `test` | every push and PR | lint, build, and the 24 tests against a throwaway Postgres service |
| `deploy` | pushes to `main` only | build `linux/amd64`, ship over SSH once, restart **both** instances, verify both hosts |

The deploy job is skipped for pull requests, so a PR gets the test gate without
touching production.

**Freezing the demo.** The demo's `up -d`, health wait and endpoint check are guarded
by `if: vars.DEPLOY_DEMO != 'false'`. Set the repository variable to freeze it for
defence week; live still deploys, and the demo's volumes are untouched either way.

```bash
gh variable set DEPLOY_DEMO --body false   # freeze the demo
gh variable delete DEPLOY_DEMO             # back to deploying both
```
 Deploys are serialised by a `deploy-vps` concurrency group
and queue rather than cancel — an interrupted `docker load` on a 1GB box is worse
than waiting. GitHub runners are x86_64, so the image build is native there
rather than emulated as it is on an ARM Mac.

### Required secrets

Set these once (values never need to live in the repo):

```bash
gh secret set VPS_SSH_KEY < ~/repos/personal/ssh1.pem
gh secret set VPS_HOST --body 202.74.75.193
gh secret set VPS_USER --body fazadev
```

`~/hrms/.env` and `~/hrms-live/.env` are created once by hand and are **never**
overwritten by CI; the deploy fails loudly if either is missing.

To redeploy the current `main` without an empty commit, use the workflow's
`workflow_dispatch` trigger (Actions → CI / Deploy → Run workflow).

## Operations

```bash
VPS='ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193'

# Demo (swap ~/hrms → ~/hrms-live and hrms-app → hrms-live-app for the live one)
$VPS 'cd ~/hrms && docker compose logs -f --tail 50 hrms-app'
$VPS 'cd ~/hrms && docker compose ps'
$VPS 'docker stats --no-stream | grep hrms'
$VPS 'cd ~/hrms && docker compose restart hrms-app'

# psql into the database (no published port; go through the container)
$VPS 'docker exec -it hrms-db psql -U hrms -d hrms'
$VPS 'docker exec -it hrms-live-db psql -U hrms -d hrms'
```

### Rollback

Both deploy paths tag the outgoing image `hrms-app:previous` before loading the new
one, so a rollback is a retag with nothing to prepare in advance:

```bash
$VPS 'docker tag hrms-app:previous hrms-app:deploy'
$VPS 'cd ~/hrms-live && docker compose up -d'   # or ~/hrms for the demo
```

Both instances share the `hrms-app:deploy` tag, so the retag rolls back whichever one
you then bring up. Bring up only the one you meant to move.

Note this rolls back **code only**. A migration applied by the newer image stays
applied; Prisma has no automatic down-migration.

### Backups

The **demo** has no automated backup and needs none — `pnpm prisma:seed` and
`scripts/demo-data.ts` rebuild it. To snapshot anyway:

```bash
$VPS 'docker exec hrms-db pg_dump -U hrms hrms | gzip' > hrms-$(date +%F).sql.gz
```

The **live** instance is backed up nightly at 03:00 Asia/Jakarta by cron on the box,
running `~/hrms-live/backup.sh`. Check the host clock with `timedatectl` before
touching the schedule — cron uses the host timezone.

```sh
docker exec hrms-live-db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > ~/hrms-backups/hrms-live-$(date +%F).sql.gz
find ~/hrms-backups -name 'hrms-live-*.sql.gz' -mtime +14 -delete
```

`pg_dump` runs inside the container, so nothing new is installed on the box. Backups
stay on the same box: that covers a bad migration or a mistaken delete, not losing the
VPS. **Restore the first dump into a throwaway database once** — an untested backup is
not a backup.

## Local development

```bash
docker compose up          # db :5433, API :5001, client :5173
docker compose down        # add -v to drop the database volume too
```

Open **http://localhost:5173**. The first boot installs the workspace, applies
migrations, and seeds demo data (only when the database is empty), so it takes a
few minutes; subsequent starts are fast.

Two port choices worth knowing:

- **Postgres publishes 5433**, not 5432, so it does not collide with a Homebrew
  Postgres on the host.
- **The API publishes 5001**, not 5000, because macOS AirPlay Receiver listens on
  `*:5000` and answers `403` before Docker's bind is reached. Inside the network
  the API is still on 5000, which is what Vite proxies to.

The host workflow (`pnpm dev` against brew Postgres) still works unchanged — the
compose stack is an alternative, not a replacement, and uses a separate database.

## Troubleshooting

| Symptom | Check |
|---|---|
| 404 from Traefik | `docker logs traefik --tail 50`; confirm `hrms-app` is on the `web` network |
| Cert not issued | DNS must resolve before issuance; `curl 127.0.0.1:8080/api/http/routers` on the box |
| App unhealthy | `docker compose logs hrms-app` — usually a failed migration |
| OOM / other services dying | `free -m`, `docker stats`, `dmesg \| grep -i "out of memory"` |
| Seed did not run | Only runs when `User` is empty and `SEED_ON_START=true` |
| Cannot log in to live at all | `BOOTSTRAP_HR_EMAIL`/`_PASSWORD` missing at first boot; `docker compose logs hrms-live-app \| grep bootstrap` |
| Demo login buttons on live | `DEMO_MODE` must be `"false"` in `docker-compose.live.yml`; check `curl https://hr.muhammadfaza.com/api/v1/config` |
