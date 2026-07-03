# 0003 - Package manager standard: pnpm (Node) + uv (Python)

## Status

Accepted — 2026-07-03

## Context

ADR-0001 decided the core API stays NestJS/TypeScript, with a future
Fas 3+ video-validation/tagging feature as the one plausible case for a
small, separate Python service. That gives this project two possible
language ecosystems over time: Node/TypeScript (backend now, Expo frontend
soon) and, later, Python (only if/when that separate service gets built).

This is a volunteer, open-source project with contributors rotating in
and out — a consistent, low-friction package manager per ecosystem matters
more here than it would for a small fixed team, since every contributor
needs to get a working install with minimal local troubleshooting.

## Decision

**Node/TypeScript services (current NestJS API, future Expo app): pnpm.**
**Any future Python service (Fas 3+ only, not built yet): uv.**

Why pnpm over npm/yarn:
- Content-addressable store means one shared package cache on disk instead
  of a `node_modules` copy per project — relevant once this repo also has
  an Expo app alongside the API.
- Strict, non-flat `node_modules` layout catches "phantom dependency" bugs
  (importing a package that's only transitively installed) at install
  time instead of surprising a contributor in CI.
- Materially faster installs, which matters for CI runtime and for
  drive-by contributors who just want to get running quickly.

Why uv, whenever a Python service exists:
- Single tool replacing pip + venv + poetry/pip-tools, which matters for a
  project with no dedicated Python tooling expertise — fewer moving parts
  to explain in a README.
- Fast, reproducible installs via a lockfile, matching the reliability bar
  pnpm already sets on the Node side.
- Nothing to scaffold today — this is a standard to follow *when* Fas 3's
  video service is actually built, not a reason to create Python tooling
  now.

## Consequences

- `backend/` migrates from npm to pnpm now (separate follow-up task):
  `package-lock.json` → `pnpm-lock.yaml`, Dockerfile updated to install via
  pnpm (via Corepack, so no separate global pnpm install step is needed).
- CI and any future contributor docs should assume pnpm for Node work —
  don't reintroduce npm/yarn lockfiles alongside it.
- No action needed on the Python side yet. When the Fas 3+ video service
  is actually started, it should ship a `pyproject.toml` + `uv.lock` from
  day one rather than picking a Python tool at that time under roadmap
  pressure.
- If a contributor's environment can't run Corepack/pnpm for some reason,
  that's a CI/environment bug to fix, not a reason to accept a second
  lockfile format.
