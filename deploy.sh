#!/usr/bin/env bash
#
# Deploy LA-ERP on the production server (filemaker-server, user ubuntu).
#   1. Pull latest code (fast-forward only)
#   2. Install dependencies — only if the lockfile changed
#   3. Build into the idle build slot while the live site keeps serving
#   4. Build and start the wacli (WhatsApp) container from docker-compose.yml
#   5. Take a pre-deploy database snapshot into ~/backups (insurance before
#      migrations run); the newest $KEEP_SNAPSHOTS are kept
#   6. Point the service at the new slot and restart — this automatically runs
#      `prisma migrate deploy` and the seed via the systemd ExecStartPre hooks
#   7. Wait until the app is serving; if it never does, switch back to the
#      previous build and fail loudly with logs
#
# Build slots: `next build` empties its output folder first, so building in
# place broke pages for as long as the build ran. Builds now alternate between
# .next-a and .next-b (NEXT_DIST_DIR, read by next.config.ts); .next-slot.env
# names the live one and la-erp.service loads it. The previous slot is kept, so
# a rollback is:  echo NEXT_DIST_DIR=<old slot> > .next-slot.env && sudo systemctl restart la-erp
#
# Server layout this script expects:
#   app        /home/ubuntu/LA-erp (wherever this script lives)
#   service    la-erp.service, `next start -p 3100` (PORT in .env), with
#              EnvironmentFile=-/home/ubuntu/LA-erp/.next-slot.env
#   proxy      Caddy on 443 (https://geosecure.travel) -> 127.0.0.1:3100.
#              It holds requests for up to 30s while the app restarts.
#   watchdog   la-erp-watchdog.timer restarts a hung app; it stands aside
#              while /run/la-erp-deploy.lock exists (created below)
#   database   local PostgreSQL 16 (postgresql.service), DATABASE_URL in .env;
#              nightly snapshots by la-erp-db-backup.timer into ~/backups/nightly
#   log        /var/log/la-erp.log
#
# Usage:  ./deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-10}"
SLOT_FILE="$APP_DIR/.next-slot.env"
LOCK=/run/la-erp-deploy.lock
cd "$APP_DIR"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; }

# Read one KEY="value" line from .env without sourcing the whole file.
env_value() {
  sed -nE "s/^$1=\"?([^\"]*)\"?\s*$/\1/p" .env | tail -n 1
}

healthy() {
  [ "$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/auth/login" 2>/dev/null)" = "200" ]
}

wait_healthy() {
  # Migrations and the seed run before the server starts, so allow time for them.
  for _ in $(seq 1 90); do
    systemctl is-active --quiet la-erp && healthy && return 0
    sleep 1
  done
  return 1
}

APP_PORT="$(env_value PORT)"
APP_PORT="${APP_PORT:-3100}"

# (Read the unit first: with pipefail, `systemctl cat | grep -q` can fail at
# random when grep exits early.)
if ! grep -q '^EnvironmentFile=-*/.*\.next-slot\.env' <<< "$(systemctl cat la-erp 2>/dev/null)"; then
  fail "la-erp.service does not load $SLOT_FILE, so a new build slot would never go live."
  echo "Add this line under [Service], after the .env EnvironmentFile line, then run: sudo systemctl daemon-reload"
  echo "  EnvironmentFile=-$SLOT_FILE"
  exit 1
fi

# Keep the watchdog from restarting the app halfway through the deploy.
sudo touch "$LOCK"
trap 'sudo rm -f "$LOCK"' EXIT

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

ACTIVE_SLOT=.next   # builds made before the slots existed
if [ -f "$SLOT_FILE" ]; then
  slot="$(sed -nE 's/^NEXT_DIST_DIR=(.*)$/\1/p' "$SLOT_FILE" | tail -n 1)"
  [ -n "$slot" ] && ACTIVE_SLOT="$slot"
fi
NEW_SLOT=.next-a
[ "$ACTIVE_SLOT" = .next-a ] && NEW_SLOT=.next-b

log "Building into $NEW_SLOT (live site keeps serving $ACTIVE_SLOT)"
NEXT_DIST_DIR="$NEW_SLOT" npm run build
if ! git diff --quiet -- tsconfig.json; then
  # next build adds its folder's type paths to tsconfig.json; both slots are
  # already listed there, so a change here would block the next `git pull`.
  fail "The build changed tsconfig.json. Commit that change in the repo, or the next pull will fail."
  git diff --stat -- tsconfig.json
fi

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
find "$BACKUP_DIR" -maxdepth 1 -name 'pre-deploy-*.sql.gz' -printf '%T@ %p\n' \
  | sort -rn | tail -n +"$((KEEP_SNAPSHOTS + 1))" | cut -d' ' -f2- | xargs -r rm -f --

log "Switching to $NEW_SLOT and restarting (auto-runs: prisma migrate deploy + seed)"
echo "NEXT_DIST_DIR=$NEW_SLOT" > "$SLOT_FILE"
sudo systemctl restart la-erp

log "Waiting for the app to become healthy on port $APP_PORT"
if wait_healthy; then
  log "Deploy complete — app is up on port $APP_PORT, serving $NEW_SLOT. ✅"
  exit 0
fi

fail "App did not become healthy within 90s on $NEW_SLOT."
echo "--- recent logs ---"
sudo tail -n 30 /var/log/la-erp.log || true
systemctl status la-erp --no-pager | head -n 12 || true

if [ -d "$APP_DIR/$ACTIVE_SLOT" ]; then
  log "Rolling back to the previous build ($ACTIVE_SLOT)"
  if [ "$ACTIVE_SLOT" = .next ]; then rm -f "$SLOT_FILE"; else echo "NEXT_DIST_DIR=$ACTIVE_SLOT" > "$SLOT_FILE"; fi
  sudo systemctl restart la-erp
  if wait_healthy; then
    fail "Rolled back: the site is up on the previous build. Database migrations from this deploy, if any, were NOT undone."
  else
    fail "Rollback did not come up either. Check the logs above."
  fi
fi
echo "Database snapshot from before this deploy: $SNAPSHOT"
exit 1
