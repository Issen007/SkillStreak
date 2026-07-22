# Phase 0 scaffold Dockerfile — builds and runs the NestJS API service.
# No production-hardening (that's Fas 4); this just needs to run reliably
# under docker-compose for local development.
#
# Package manager: pnpm (docs/adr/0003-package-managers.md), installed via
# Corepack so no separate global pnpm install step is needed.

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ---- runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# ffmpeg (+ ffprobe, bundled in the same Alpine package) is required, not
# optional, for Fas 3's video-clip `complete` step — the mandatory
# metadata-stripping remux (docs/adr/0010-video-storage-and-serving.md
# Decision 3) shells out to both. Alpine's community repo (enabled by
# default in this base image) carries it, so no extra repo config needed.
RUN apk add --no-cache ffmpeg

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# Runs pending migrations against the compose Postgres before starting the
# API — see docs/adr/0002-data-model.md ("schema changes go through
# migrations, never manual edits to a running schema").
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
