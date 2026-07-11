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

echo "Running database migrations..."
node ./node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run

exec "$@"
