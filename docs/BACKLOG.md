# SkillStreak — Backlog

This document contains a list of features and improvements that was not planned for the current release of SkillStreak, but are being considered for future enhancements. The list is not exhaustive and is subject to change based on user feedback and development priorities.

## Birthday Year
At the moment it is a button for each year we support at the moment, this should be a dropdown with the years we a wider range of years, and the user can select their birthday year from the dropdown.

## Language Support
Currently, SkillStreak supports only Swedish. We plan to add support for multiple languages to cater such English, Finish, Danish, and Norwegian. This will allow users from different regions to use the app in their preferred language.

## Security Enhancements
### Encryption of the data
All data should be encrypted in the database so if the data get leaked, it will be useless for the attacker. This is a critical security measure to protect user information.

### Secure Authentication
We need to implement secure authentication methods, such as two-factor authentication (2FA) and OAuth, to enhance the security of user accounts.

## Team Chat — LLM-based Moderation (future release)
Phase 2.6b ships team chat with a keyword/profanity filter plus per-message
report/block, since that's buildable now without a new external dependency.
A better, context-aware moderation layer (catching bullying/grooming
patterns a keyword list can't, not just banned words) should use an LLM
classifier on each message before it's delivered to the team — flag/hold
suspect messages for the sending player's own parent to review rather than
silently deleting them, matching this app's "closed team bubble, parent in
the loop" posture. Deliberately deferred out of 2.6b's first pass: it needs
its own design/cost/latency tradeoff discussion (sync classification before
send vs. async post-hoc scan) and a security-reviewer pass on what "held for
review" actually means for a child's message thread.

## 24/7 Automated Uptime/Health Monitoring (future release)
Raised 2026-07-23 while auditing this project's CI/test coverage. Two
different things got asked for together and should stay separate asks:

1. **Scheduled synthetic health checks** — a cron-triggered job (e.g. a
   GitHub Actions `schedule:` workflow, or an external uptime pinger) that
   periodically hits `/health` and, ideally, exercises one real end-to-end
   flow (login + "Jag har tränat") against the deployed environment,
   alerting on failure. Cheap, well-understood, no new infrastructure
   paradigm — the same "boring, standard tool" posture this project
   already prefers.
2. **An "AI-driven" test/monitoring bot** that does more than ping an
   endpoint — reasoning about failures, triaging what broke, maybe filing
   an issue automatically. A meaningfully bigger project: needs a place to
   run continuously, an alerting/paging path, and real scoping on what
   "AI-driven" adds over a normal synthetic monitor before it's worth
   building.

**Blocked on a real prerequisite, not just priority**: per `k8s/README.md`,
this cluster currently has **no working external ingress path** — alpha
access is `kubectl port-forward` only, from whichever machine runs it. A
scheduled external check needs something to actually reach; there is no
public URL for either idea above to hit yet. Revisit once
`k8s/README.md`'s ingress/DNS situation is resolved. When it is, start with
(1) — a plain scheduled health/smoke check — before considering (2).

## Usage Analytics / Product Metrics (future release)
Raised 2026-07-23: track how players/teams actually use the app (feature
adoption, streak drop-off points, which screens get revisited, session
frequency) to guide what to build/fix next, separate from this app's
existing gamification counters (streaks, team pool points) which are
product mechanics, not analytics.

**This is a child-data feature, not a neutral tooling addition — treat it
with the same weight as Phase 3's media work, not as a quick add.**
Specifically, before this is built:
- **No third-party analytics SaaS** (Google Analytics, Mixpanel, Amplitude,
  etc.) without a real discussion — sending children's usage patterns to an
  external processor is a new sub-processor of child data. A self-hosted or
  first-party-only approach (events logged to this app's own
  Postgres/Redis, matching the "boring, already-operated infrastructure"
  pattern this project prefers) should be the default starting point, not
  an assumption that a vendor SaaS is fine because it's common practice
  elsewhere.
- **No location data**, per CLAUDE.md's standing constraint — this
  includes IP-derived geolocation, which off-the-shelf analytics SDKs often
  collect by default and would need to be explicitly stripped/disabled, not
  just "not asked for."
- **Aggregate/team-scoped by default, not individually identifying** —
  mirrors this app's existing anonymization posture (screen names, not
  `real_name`) and its cross-team query bar (structurally can't reach
  `Player`/`PlayerPrivateInfo` from anything cross-team). A coach-facing
  "how's my team doing" view is a very different, much safer thing to
  build than per-child behavioral tracking, and the former should be the
  first target, not the latter.
- Needs an **architect** pass (what's tracked, where it's stored, retention)
  and a **security-reviewer** sign-off before backend work starts, per this
  project's standing rule for anything touching child data — not a silent
  addition to existing endpoints.
