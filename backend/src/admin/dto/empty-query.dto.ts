/**
 * A DTO with no properties, for endpoints that must accept **no query
 * parameter at all** — docs/adr/0022-admin-control-center.md Decision 10's
 * `planning/*` routes.
 *
 * This exists because "the endpoint declares no `@Query()`" does NOT mean
 * unknown parameters are rejected — it means ValidationPipe is never
 * invoked for the query at all, so they are silently ignored. Found
 * 2026-08-08 by an e2e test written expecting the opposite (and note that
 * `GET /admin/usage-metrics`'s docstring has carried the same incorrect
 * assumption since it was written — see its comment).
 *
 * Declaring an empty class gives `main.ts`'s `whitelist: true` +
 * `forbidNonWhitelisted: true` something to validate against, turning
 * "accepts nothing" from a property of the handler signature into an
 * enforced 400 — which is what Decision 10 actually asks for, given this
 * pillar must never grow a filter that could resolve to a team or player.
 */
export class EmptyQueryDto {}
