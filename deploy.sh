#!/usr/bin/env bash
# Commons production deployment script.
# Run from the repository root on the VPS: ./deploy.sh
#
# Safe deploy sequence:
#   1. Pull latest code
#   2. Build new Docker image
#   3. Ensure PostgreSQL is running and healthy
#   4. Run migrations in a temporary container — if this fails, existing
#      containers are left running and the script aborts
#   5. Bring new containers online

set -euo pipefail

ENV_FILE="apps/web/.env.production"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file $ENV_FILE"

# ── Pre-flight ─────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗  Missing $ENV_FILE"
  echo "   Copy apps/web/.env.production.example and fill in every value."
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  local value
  line="$(grep -m1 -E "^${key}=" "$ENV_FILE" || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

require_env_value() {
  local key="$1"
  local value
  value="$(read_env_value "$key")"
  if [[ -z "$value" || "$value" == "CHANGE_ME" ]]; then
    echo "Required value $key is missing or still uses the placeholder in $ENV_FILE"
    exit 1
  fi
}

require_env_value "POSTGRES_USER"
require_env_value "POSTGRES_PASSWORD"
require_env_value "POSTGRES_DB"
require_env_value "SESSION_SECRET"
require_env_value "FEEDBACK_FINGERPRINT_SECRET"

session_secret="$(read_env_value "SESSION_SECRET")"
if (( ${#session_secret} < 32 )); then
  echo "SESSION_SECRET must be at least 32 characters long."
  exit 1
fi

postgres_password="$(read_env_value "POSTGRES_PASSWORD")"
if [[ ! "$postgres_password" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "POSTGRES_PASSWORD must use URL-safe characters because it is embedded in DATABASE_URL."
  echo "Generate one with: openssl rand -hex 32"
  exit 1
fi

# ── 1. Pull ────────────────────────────────────────────────────────────────

echo "▶  Pulling latest code..."
git pull --ff-only

# ── 2. Build ───────────────────────────────────────────────────────────────

echo "▶  Building production image (this takes a few minutes)..."
$COMPOSE build web

# ── 3. Ensure PostgreSQL is running ───────────────────────────────────────

echo "▶  Starting PostgreSQL..."
$COMPOSE up -d postgres

echo "   Waiting for PostgreSQL to accept connections..."
# Poll pg_isready inside the postgres container itself (most reliable)
for i in $(seq 1 30); do
  if $COMPOSE exec postgres pg_isready -q 2>/dev/null; then
    echo "   PostgreSQL is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "✗  PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

# ── 4. Run database migrations ────────────────────────────────────────────
# Uses a temporary container from the new image.
# --no-deps: does not restart the postgres container.
# If this exits non-zero the script aborts here; old web container keeps running.

echo "▶  Running database migrations..."
if ! $COMPOSE run --rm --no-deps \
    --entrypoint sh web \
    -c "prisma migrate deploy --config apps/web/prisma.config.ts"; then
  echo ""
  echo "✗  Migration failed. Deployment aborted."
  echo "   Existing containers are still running."
  echo "   Check the error above, fix the issue, then run ./deploy.sh again."
  exit 1
fi

# ── 5. Deploy ──────────────────────────────────────────────────────────────

echo "▶  Deploying new containers..."
$COMPOSE up -d --remove-orphans

echo ""
echo "▶  Container status:"
$COMPOSE ps

echo ""
echo "✓  Deploy complete."
