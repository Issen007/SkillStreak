#!/bin/sh
# Runs pending TypeORM migrations against whatever Postgres DATABASE_URL
# points at, then execs the real CMD (node dist/main.js). Kept as a tiny
# shell wrapper rather than baked into main.ts so migrations run once at
# container start, not on every app bootstrap/reload.
set -e

echo "Running database migrations..."
node ./node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run

exec "$@"
