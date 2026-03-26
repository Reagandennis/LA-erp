#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe1234}"

echo "Logging in as bootstrap admin..."
curl -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -c "$COOKIE_JAR" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/login"
echo

echo "Fetching session..."
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/auth/session"
echo

echo "Fetching admin users..."
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/users"
echo

echo "Fetching audit log..."
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/admin/audit"
echo

echo "Logging out..."
curl -sS -X POST -b "$COOKIE_JAR" "$BASE_URL/api/auth/logout"
echo
