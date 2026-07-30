# Deploying HRMS Aisahub

Production target: **https://hrms.muhammadfaza.com** on the VPS at `202.74.75.193`,
in `/home/fazadev/hrms/`.

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
                          └→ hrms-app :5000   /api/v1/* → Express
                               │               /*        → client SPA
                               └ hrms-internal → hrms-db (postgres:16-alpine)
```

## First deploy

1. **DNS** — already done: `hrms.muhammadfaza.com` resolves to `202.74.75.193`.
   Traefik uses the HTTP challenge, so this must be true before the cert can issue.

2. **Create the remote env file.** It is not in git and the deploy script refuses
   to run without it.

   ```bash
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 'mkdir -p ~/hrms'
   scp -i ~/repos/personal/ssh1.pem .env.docker.example fazadev@202.74.75.193:~/hrms/.env
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 'chmod 600 ~/hrms/.env && vi ~/hrms/.env'
   ```

   Fill in `POSTGRES_PASSWORD` and `JWT_SECRET` with `openssl rand -hex 32`.

3. **Deploy.**

   ```bash
   ./deploy/deploy.sh
   ```

   It refuses to proceed if the VPS has under 150MB available, builds for
   `linux/amd64`, ships the image, syncs the compose file, starts the stack, waits
   for the healthcheck, and curls the public endpoint.

4. **Confirm the certificate issued.**

   ```bash
   ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193 'docker logs traefik --tail 30'
   ```

5. **Add HRMS to the VPS inventory** — append it to the tables in `~/CLAUDE.md`
   on the box, per that file's own checklist.

## Redeploying

```bash
./deploy/deploy.sh
```

Migrations run automatically on container start. Seeding does **not** re-run: the
entrypoint seeds only when the `User` table is empty.

## Operations

```bash
VPS='ssh -i ~/repos/personal/ssh1.pem fazadev@202.74.75.193'

$VPS 'cd ~/hrms && docker compose logs -f --tail 50 hrms-app'
$VPS 'cd ~/hrms && docker compose ps'
$VPS 'docker stats --no-stream | grep hrms'
$VPS 'cd ~/hrms && docker compose restart hrms-app'

# psql into the database (no published port; go through the container)
$VPS 'docker exec -it hrms-db psql -U hrms -d hrms'
```

### Rollback

`docker save`/`load` keeps whatever image tags are already on the box, so tag
before overwriting if you want a way back:

```bash
$VPS 'docker tag hrms-app:deploy hrms-app:previous'   # BEFORE deploying
# then, to roll back:
$VPS 'docker tag hrms-app:previous hrms-app:deploy && cd ~/hrms && docker compose up -d'
```

Note this rolls back **code only**. A migration applied by the newer image stays
applied; Prisma has no automatic down-migration.

### Backups

There is no automated backup — this is a demo deployment with seeded data. To
snapshot anyway:

```bash
$VPS 'docker exec hrms-db pg_dump -U hrms hrms | gzip' > hrms-$(date +%F).sql.gz
```

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
