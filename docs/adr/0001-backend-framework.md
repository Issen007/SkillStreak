# 0001 - Backend framework: NestJS (TypeScript)

## Status

Accepted — 2026-07-03

## Context

The README/CLAUDE.md leave the backend framework open between two options:

- **NestJS** (Node.js/TypeScript, Express or Fastify under the hood)
- **FastAPI** (Python)

Both are perfectly capable of building the Fas 1-2 API surface (auth,
Team/Player/Coach CRUD, streak logic, team pool logic, later challenge
CRUD). The decision isn't about raw capability, it's about fit for *this*
project's constraints:

- The frontend is React Native + Expo in **TypeScript**. Whatever backend we
  pick has to expose a contract (DTOs/types) that frontend code consumes.
- One planned feature — the coach's "AI-Träningsschema" — calls an LLM
  (Claude) to generate a training plan from a prompt. This is the one
  feature where Python's data/ML ecosystem is sometimes assumed to be a
  natural fit.
- The team is a solo coach plus **volunteer, open-source contributors** who
  come and go. There's no dedicated backend team enforcing conventions
  across PRs. Contributors are more likely to arrive already comfortable
  with the RN/TS frontend than with a Python backend, since that's the
  more visible, easier-to-demo part of the project.
- We're pre-MVP: Fas 1 needs a health-check endpoint, then Team/Player/Coach
  CRUD and streak/pool logic. No heavy compute, no ML training, no data
  pipelines.

## Decision

**Use NestJS (TypeScript) for the backend.**

Reasoning:

1. **One language across the whole stack.** Expo/React Native is already
   TypeScript. With NestJS, DTOs/interfaces (e.g. `Player`, `TrainingLogEntry`,
   `TeamSeasonPot`) can be shared or mirrored directly between frontend and
   backend, and the same contributor can read/patch both sides of a feature
   without a context switch. For a volunteer project where people contribute
   in short, irregular bursts, this materially lowers the bar to a useful PR.

2. **The LLM feature doesn't actually need Python.** Generating a training
   plan from a prompt is calling an LLM API (Claude) over HTTP and shaping
   the response — there's no local model training, no numpy/pandas/
   dataframe work, no GPU inference happening in our backend. Node has
   mature HTTP/SDK support for this. Python's advantage here is folklore,
   not a real technical requirement for what's actually being built. If a
   genuinely Python-shaped need shows up later (e.g. local embeddings,
   offline analytics), that's a case for a small, separate Python service —
   not a reason to run the whole API in Python today (see Consequences).

3. **NestJS's opinionation suits a project with many small, occasional
   contributors.** Its module/controller/service structure, DI, and
   decorator-based validation give every contributor the same shape to
   follow, so a drive-by PR from someone who's only touched the codebase
   once still looks like the rest of the codebase. FastAPI is lighter and
   very pleasant with a small, stable team, but with volunteers rotating
   through, that flexibility tends to fragment into inconsistent per-PR
   style with no one around to enforce conventions.

4. **Ecosystem fit for our actual dependencies.** Auth (JWT/session),
   Postgres (via Prisma or TypeORM), Redis, WebSockets/SSE for live
   leaderboard updates, and Docker packaging are all first-class and
   well-documented in Nest. Nothing about our near-term roadmap (Fas 1-3)
   plays to a Python-specific strength.

## Consequences

- Contributors need Node/TypeScript familiarity; contributors who are
  Python-first will have a slightly higher bar to contribute to the API
  (mitigated by NestJS's conventional structure and by keeping modules
  small and readable).
- Type contracts between frontend and backend should be defined once
  (e.g. in a shared `packages/shared-types` workspace or generated from
  the API, decision left to backend-developer/frontend-developer) rather
  than duplicated by hand — otherwise this ADR's main benefit is wasted.
- If a future feature genuinely needs Python's data/ML ecosystem (e.g.
  local inference, statistical analysis of training data at scale), the
  recommended path is a small, separate Python service behind its own
  internal endpoint — not migrating the core API. This is not needed for
  anything currently on the roadmap.
- The LLM integration itself (calling Claude from the challenge
  builder/training-plan generator) is just another NestJS module; it
  should live behind a service interface so the LLM provider can be
  swapped without touching controllers.

## Addendum — 2026-07-03

Revisited after the project owner raised a specific future need: validating
uploaded video clips and auto-tagging them by category (Fas 3+), which
sounds like an ML workload and a natural fit for Python's ecosystem.

Decision stands: **core API stays NestJS.** This scenario is exactly the
"separate Python service" escape hatch already described above, not a
reason to move the whole API — in-house video classification is Fas 3+
work, will likely start as calls to a hosted vision/classification model
rather than a self-trained one, and either way only needs its own small
FastAPI service behind an internal endpoint. Moving the entire backend to
FastAPI now would pay the shared-TypeScript-contract cost (reasoning above)
across every feature between now and Fas 3, for a need that's narrow,
distant, and may not require local ML at all. Re-open this ADR only if a
concrete Fas 3 video-ML spec turns out to need something a separate service
can't provide.
