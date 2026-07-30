#!/usr/bin/env bash
#
# Build the HRMS image locally and ship it to the VPS.
#
# The VPS has 1GB RAM and must never build (see ~/CLAUDE.md on the box), so the
# image is built here, streamed over SSH, and loaded into the remote Docker.
# Same pattern as veydar and square-menu-explorer.
#
#   ./deploy/deploy.sh                 # build + ship + restart
#   ./deploy/deploy.sh --skip-build    # re-ship the image already built locally
#   SSH_KEY=~/other.pem ./deploy/deploy.sh
#
set -euo pipefail

IMAGE="${IMAGE:-hrms-app:deploy}"
SSH_HOST="${SSH_HOST:-fazadev@202.74.75.193}"
SSH_KEY="${SSH_KEY:-$HOME/repos/personal/ssh1.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/fazadev/hrms}"
DOMAIN="${DOMAIN:-hrms.muhammadfaza.com}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH="ssh -i $SSH_KEY -o BatchMode=yes"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$SSH_KEY" ] || die "SSH key not found: $SSH_KEY"

# --- preflight ------------------------------------------------------------
log "Checking VPS reachability and free memory"
$SSH "$SSH_HOST" 'free -m' || die "cannot reach $SSH_HOST"

AVAIL=$($SSH "$SSH_HOST" "free -m | awk '/^Mem:/{print \$7}'")
if [ "$AVAIL" -lt 150 ]; then
  # 1GB box with an OOM history — refuse rather than take down other services.
  die "only ${AVAIL}MB available on the VPS; need ~150MB. Free memory before deploying."
fi
echo "OK: ${AVAIL}MB available"

# --- build ----------------------------------------------------------------
if [ "${1:-}" != "--skip-build" ]; then
  log "Building $IMAGE (linux/amd64 — the VPS is x86_64, this Mac may not be)"
  docker build --platform linux/amd64 -t "$IMAGE" "$REPO_ROOT"
else
  log "Skipping build (--skip-build)"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "$IMAGE not built locally"
fi

# --- ship -----------------------------------------------------------------
SIZE=$(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{printf "%.0f", $1/1024/1024}')
log "Shipping $IMAGE (~${SIZE}MB uncompressed) over SSH"
docker save "$IMAGE" | gzip -1 | $SSH "$SSH_HOST" 'gunzip | docker load'

# --- remote files ---------------------------------------------------------
log "Syncing compose file to $REMOTE_DIR"
$SSH "$SSH_HOST" "mkdir -p $REMOTE_DIR"
scp -i "$SSH_KEY" "$REPO_ROOT/docker-compose.prod.yml" "$SSH_HOST:$REMOTE_DIR/docker-compose.yml"

$SSH "$SSH_HOST" "test -f $REMOTE_DIR/.env" || die \
  "$REMOTE_DIR/.env missing on the VPS. Create it from .env.docker.example first:
     scp -i $SSH_KEY .env.docker.example $SSH_HOST:$REMOTE_DIR/.env
     $SSH $SSH_HOST 'chmod 600 $REMOTE_DIR/.env && vi $REMOTE_DIR/.env'"

# --- start ----------------------------------------------------------------
log "Starting containers"
$SSH "$SSH_HOST" "cd $REMOTE_DIR && docker compose up -d"

log "Waiting for the app to become healthy (first boot migrates and seeds)"
for i in $(seq 1 30); do
  STATUS=$($SSH "$SSH_HOST" "docker inspect --format '{{.State.Health.Status}}' hrms-app 2>/dev/null || echo missing")
  [ "$STATUS" = "healthy" ] && break
  printf '  [%02d/30] %s\n' "$i" "$STATUS"
  sleep 5
done
[ "${STATUS:-}" = "healthy" ] || {
  $SSH "$SSH_HOST" "cd $REMOTE_DIR && docker compose logs --tail 40 hrms-app"
  die "hrms-app did not become healthy (last status: ${STATUS:-unknown})"
}

# --- verify ---------------------------------------------------------------
# Retry rather than check once: on a first deploy Let's Encrypt needs a little
# time to issue, and a single early check reports a misleading failure for a
# deployment that is actually fine.
log "Verifying public endpoint (allowing time for cert issuance)"
CODE=000
for i in $(seq 1 12); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/v1/health" 2>/dev/null) || CODE=000
  [ "$CODE" = "200" ] && break
  printf '  [%02d/12] https://%s -> %s\n' "$i" "$DOMAIN" "$CODE"
  sleep 10
done

if [ "$CODE" = "200" ]; then
  echo "OK: https://$DOMAIN/api/v1/health -> 200"
else
  echo "WARNING: https://$DOMAIN/api/v1/health -> $CODE after 2 minutes"
  echo "The containers are healthy, so this is most likely TLS or routing:"
  echo "  $SSH $SSH_HOST 'docker logs traefik --tail 30'"
  echo "  $SSH $SSH_HOST 'curl -s 127.0.0.1:8080/api/http/routers | grep -i hrms'"
fi

log "Memory after deploy"
$SSH "$SSH_HOST" 'free -m; docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" | grep -E "hrms|NAME"'

log "Done. https://$DOMAIN"
