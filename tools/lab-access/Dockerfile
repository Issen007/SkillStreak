# Runs the lab-access dev/demo tool (QR code + phone simulator) under
# docker-compose. Single-stage, dev-server-as-is (no adapter-node build) --
# this is a standalone local tool (see README.md), not a deployed service,
# so there's no production hardening to do here.
#
# Package manager: pnpm (docs/adr/0003-package-managers.md), via Corepack.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 4400
CMD ["pnpm", "run", "dev"]
