#!/bin/sh
# Runs pending TypeORM migrations against whatever Postgres DATABASE_URL
# points at, then execs the real CMD (node dist/main.js). Kept as a tiny
# shell wrapper rather than baked into main.ts so migrations run once at
# container start, not on every app bootstrap/reload.
set -e

# DATABASE_URL is built here, not by string-interpolating
# postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@... directly in
# docker-compose.yml/k8s/api-deployment.yaml, because a raw password can
# contain characters (@, :, /, %, ...) that are only valid in a URL once
# percent-encoded — a real generated secret hit exactly this and broke
# every deploy with "Invalid URL". If DATABASE_URL is already set (e.g.
# backend/.env.example's literal value for non-Docker local dev), leave
# it alone.
if [ -z "$DATABASE_URL" ] && [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ] && [ -n "$POSTGRES_DB" ]; then
  export DATABASE_URL=$(node -e "
    const [, user, password, host, port, db] = process.argv;
    const enc = encodeURIComponent;
    console.log(\`postgres://\${enc(user)}:\${enc(password)}@\${host}:\${port}/\${enc(db)}\`);
  " "$POSTGRES_USER" "$POSTGRES_PASSWORD" "${POSTGRES_HOST:-postgres}" "${POSTGRES_PORT:-5432}" "$POSTGRES_DB")
fi

# Wrapped in a Postgres session-level advisory lock (dist/scripts/
# migrate-with-lock.js, compiled from backend/src/scripts/
# migrate-with-lock.ts) rather than calling the TypeORM CLI directly here —
# with 2+ concurrently-starting api replicas, two pods used to race
# `migration:run` against each other and stall the rollout (see
# k8s/README.md's "Migration race with multiple api replicas" note for the
# incident, now resolved). Only one pod's migration attempt actually runs
# at a time; the rest block on the lock, then find nothing new to apply.
# Exits with the migration CLI's own exit code — `set -e` above stops this
# script (and thus the container) if that's non-zero.
echo "Running database migrations (behind a Postgres advisory lock)..."
node dist/scripts/migrate-with-lock.js

exec "$@"
