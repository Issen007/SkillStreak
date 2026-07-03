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

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
