#!/usr/bin/env bash
#
# Deploy LA-ERP on the production server (filemaker-server, user ubuntu).
#   1. Pull latest code (fast-forward only)
#   2. Install dependencies — only if the lockfile changed
#   3. Build
#   4. Build and start the wacli (WhatsApp) container from docker-compose.yml
#   5. Take a pre-deploy database snapshot into ~/backups (insurance before
#      migrations run); the newest $KEEP_SNAPSHOTS are kept
#   6. Restart the service — this automatically runs `prisma migrate deploy`
#      and the seed via the systemd ExecStartPre hooks
#   7. Wait until the app is serving on its own port, or fail loudly with logs
#
# Server layout this script expects:
#   app        /home/ubuntu/LA-erp (wherever this script lives)
#   service    la-erp.service, `next start -p 3100` (PORT in .env)
#   proxy      Caddy on :8443 -> 127.0.0.1:3100. Port 3000 on this box is
#              FileMaker's own Node process, so never health-check 3000 here.
#   database   local PostgreSQL 16 (postgresql.service), DATABASE_URL in .env
#   log        /var/log/la-erp.log
#
# Usage:  ./deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-10}"
cd "$APP_DIR"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; }

# Read one KEY="value" line from .env without sourcing the whole file.
env_value() {
  sed -nE "s/^$1=\"?([^\"]*)\"?\s*$/\1/p" .env | tail -n 1
}

APP_PORT="$(env_value PORT)"
APP_PORT="${APP_PORT:-3100}"

log "Pulling latest code"
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)
[ "$BEFORE" = "$AFTER" ] && echo "Already up to date (no new commits)."
git log --oneline -1

log "Checking dependencies"
if [ "$BEFORE" != "$AFTER" ] && ! git diff --quiet "$BEFORE" "$AFTER" -- package-lock.json package.json; then
  echo "Lockfile changed — installing dependencies (npm ci)."
  npm ci
else
  echo "Dependencies unchanged — skipping install."
fi

log "Building"
npm run build

log "Building and starting the wacli (WhatsApp) container"
# Cached unless docker/wacli/Dockerfile changed. Done here, not by the app at
# boot, so a slow image build never holds up the health check below.
docker compose build wacli
docker compose up -d --no-deps wacli

log "Taking pre-deploy database snapshot"
# pg_dump rejects Prisma's ?schema=... style query parameters, so drop them.
DB_URL="$(env_value DATABASE_URL)"
DB_URL="${DB_URL%%\?*}"
[ -n "$DB_URL" ] || { fail "DATABASE_URL is not set in $APP_DIR/.env"; exit 1; }
mkdir -p "$BACKUP_DIR"
SNAPSHOT="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD).sql.gz"
pg_dump --no-owner "$DB_URL" | gzip > "$SNAPSHOT"
echo "Saved $SNAPSHOT ($(du -h "$SNAPSHOT" | cut -f1))"
# Keep only the newest pre-deploy snapshots; other files in the folder are left alone.
ls -1t "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_SNAPSHOTS + 1))" | xargs -r rm -f --

log "Restarting app (auto-runs: prisma migrate deploy + seed)"
sudo systemctl restart la-erp

log "Waiting for the app to become healthy on port $APP_PORT"
# Migrations and the seed run before the server starts, so allow time for them.
for _ in $(seq 1 90); do
  if systemctl is-active --quiet la-erp \
     && [ "$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/auth/login" 2>/dev/null)" = "200" ]; then
    log "Deploy complete — app is up on port $APP_PORT. ✅"
    exit 0
  fi
  sleep 1
done

fail "App did not become healthy within 90s."
echo "--- recent logs ---"
sudo tail -n 30 /var/log/la-erp.log || true
systemctl status la-erp --no-pager | head -n 12 || true
echo "Database snapshot from before this deploy: $SNAPSHOT"
exit 1
