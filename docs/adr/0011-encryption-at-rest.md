# 0011 - Encryption at rest for player PII (Fas 4)

## Status

Accepted — 2026-07-28.

## Context

`docs/PROJECT.md`'s Fas 4 punch list carried "Kryptering av data i vila
(Postgres) — allmän produktionshärdning" as an unstarted item. The project
owner asked to continue on it directly, alongside a related question about
whether app↔server traffic is encrypted in transit (answered separately,
in chat — not TLS yet; `ingress-nginx`/`cert-manager`/`metallb` are already
installed and running on the cluster, but the real blocker is a public
domain + DNS + router port-forwarding, not Kubernetes config — tracked as
Fas 4 item 1 in `docs/PROJECT.md`, corrected there with this finding).

Investigated what "encryption at rest" could actually mean for this
deployment before picking an approach:

- Postgres' data lives on `local-path-provisioner` (the cluster's default
  StorageClass) — a plain host-filesystem directory
  (`/opt/local-path-provisioner`) on the node itself, with no built-in
  encryption of any kind.
- Vanilla open-source PostgreSQL (this app's `postgres:18-alpine` image)
  has no transparent-data-encryption feature — that's a commercial/patched
  Postgres capability (EDB, Percona), not something available here.
- Real full-disk encryption would mean LUKS/dm-crypt on the host disk
  itself — a host-OS-level change, not a Kubernetes manifest. It needs
  root (this session only has an unprivileged account on the node) and is
  disruptive: the existing PVC data would need backing up, the volume
  reformatted encrypted, and the data restored — real downtime, not a
  rolling change.

Presented both options to the project owner directly (host-level LUKS vs.
application-level column encryption for the actually-sensitive fields).
**Decision: column-level encryption now**, with full-disk LUKS left as a
separate, explicitly-deferred item for whenever downtime can be
coordinated — not decided here, not silently dropped either.

## Decision

**Application-level AES-256-GCM encryption of `PlayerPrivateInfo.
parent_contact`/`real_name`** — the only two fields this app's threat
model already treats as genuinely sensitive PII (they're the entire
reason `PlayerPrivateInfo` exists as an isolated table in the first place,
per `docs/adr/0002-data-model.md`'s 2026-07-03 addendum §1). Every other
table in this schema is either non-identifying (screen names, avatar
IDs, points, streaks) or already access-controlled the same way regardless
of disk-level encryption (session tokens, reissue codes — short-lived,
single-use, already the actual security boundary independent of storage).

### Why application-level, not Postgres' `pgcrypto` extension

`pgcrypto`'s symmetric functions (`pgp_sym_encrypt`/`pgp_sym_decrypt`) need
the passphrase passed as a literal argument into every single query. That
risks the key leaking into Postgres' own query log, slow-query log, and
WAL — a well-known operational footgun for `pgcrypto`'s symmetric-key
mode unless handled very carefully (session-scoped `SET` + log scrubbing).
Application-level encryption (Node's built-in `crypto` module — no new
dependency) keeps the key in the Node process's own memory only; it's
never sent to Postgres, and never appears in anything Postgres logs.

### Implementation

- `backend/src/common/crypto/pii-encryption.util.ts` — `encryptPii`/
  `decryptPii`, AES-256-GCM (authenticated — a tampered ciphertext fails
  to decrypt rather than silently returning garbage, not just
  confidentiality). Stored format: `base64(iv (12B) || authTag (16B) ||
  ciphertext)`, a single opaque string — no column type change needed,
  `parent_contact`/`real_name` were already unbounded `varchar`.
- `PlayerPrivateInfoService` — already the sole gatekeeper for these two
  columns (ADR-0002 addendum §1's existing boundary is exactly what makes
  this a one-file change): `createForNewPlayer` encrypts on write,
  `getParentContact`/`getRealName` decrypt on read. Every other caller in
  this codebase already goes through this service, so nothing else needed
  to change.
- `src/scripts/seed.ts` — the one exception to that boundary (a standalone
  script, outside `PlayerPrivateInfoModule`, that constructs
  `PlayerPrivateInfo` rows directly via the raw repository): encrypts
  inline using the same utility, since it can't go through the service.
- New migration `EncryptPlayerPrivateInfo1785200000000` — a pure data
  migration (no schema change), encrypting every pre-existing plaintext
  row in place. `down()` is symmetric (decrypts back), for a real
  rollback path, not just documentation of intent.
- New required env var `PII_ENCRYPTION_KEY` (base64-encoded 32-byte
  AES-256 key, `openssl rand -base64 32`) — required, not optional-degrade
  like SMTP: a missing key must never silently fall back to storing PII in
  plaintext, since that would defeat the entire point. Wired into
  `env.validation.ts`, `.env.example`/`backend/.env.example` (a real,
  valid dev-only key so local dev/e2e work out of the box),
  `docker-compose.yml`, `k8s/secret.yaml.example` +
  `k8s/api-deployment.yaml`, and the CI workflow (a real, valid,
  CI-only key — `PII_ENCRYPTION_KEY` isn't a placeholder string like
  `JWT_SECRET`'s CI value, since the crypto util throws on anything that
  doesn't decode to exactly 32 bytes).

### Key rotation

Not automated — same manual-rotation posture this project already has for
`JWT_SECRET`. Rotating `PII_ENCRYPTION_KEY` requires re-running the
migration's `up()`/`down()` logic against the old key (decrypt) then the
new one (re-encrypt), noted directly in `k8s/secret.yaml.example`'s
comment so it isn't forgotten later.

## Consequences

- Real, verified protection: confirmed live against the local dev
  Postgres instance that `parent_contact`/`real_name` are no longer
  readable as plaintext via a direct `SELECT` — only through the app
  layer, which has the key.
- Protects against a materially different (and arguably more realistic)
  threat than full-disk encryption would: a stolen/leaked `pg_dump`
  backup, a compromised read-only DB credential, or file-level access to
  a copied PVC snapshot. Full-disk LUKS protects against a stolen physical
  disk specifically — a real, separate threat, still open (see below).
- **Not done, deliberately deferred, not silently dropped:** host-level
  full-disk encryption (LUKS/dm-crypt on the node). Needs root access this
  session doesn't have, and real coordinated downtime (backup → reformat
  → restore) — a decision for whenever the project owner wants to schedule
  that, tracked in `docs/PROJECT.md`'s Fas 4 list.
- No column type changes, no new external dependency, no change to any
  caller outside `PlayerPrivateInfoService`/`seed.ts` — the existing
  ADR-0002 addendum §1 boundary is what made this a contained change.
- 195/195 unit tests, 100/100 e2e tests pass unchanged — the full
  consent/self-verification/session-reissue email flows all still work
  correctly with encrypted values round-tripping through real Postgres.
