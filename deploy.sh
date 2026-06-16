#!/usr/bin/env bash
#
# Deploy LA-ERP.
#   1. Pull latest code (fast-forward only)
#   2. Install dependencies — only if the lockfile changed
#   3. Build
#   4. Take a pre-deploy database snapshot (insurance before migrations run)
#   5. Restart the service — this automatically runs `prisma migrate deploy`
#      and the seed via the systemd ExecStartPre hooks
#   6. Wait until the app is serving, or fail loudly with logs
#
# Usage:  ./deploy.sh
set -euo pipefail

APP_DIR=/home/ec2-user/LA-erp
cd "$APP_DIR"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; }

log "Pulling latest code"
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)
[ "$BEFORE" = "$AFTER" ] && echo "Already up to date (no new commits)."

log "Checking dependencies"
if [ "$BEFORE" != "$AFTER" ] && ! git diff --quiet "$BEFORE" "$AFTER" -- package-lock.json package.json; then
  echo "Lockfile changed — installing dependencies (npm ci)."
  npm ci
else
  echo "Dependencies unchanged — skipping install."
fi

log "Building"
npm run build

log "Taking pre-deploy database snapshot"
sudo systemctl start la-erp-backup.service

log "Restarting app (auto-runs: prisma migrate deploy + seed)"
sudo systemctl restart la-erp

log "Waiting for the app to become healthy"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet la-erp \
     && curl -sS --max-time 3 -o /dev/null http://127.0.0.1:3000/; then
    log "Deploy complete — app is up. ✅"
    exit 0
  fi
  sleep 1
done

fail "App did not become healthy within 30s."
echo "--- recent logs ---"
sudo tail -n 30 /var/log/la-erp.log || true
systemctl status la-erp --no-pager | head -n 12 || true
exit 1
