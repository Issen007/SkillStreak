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

## Video Clip Content Moderation (future release)
Phase 3 (`docs/adr/0010-video-storage-and-serving.md`) ships the team video
feed with deterministic technical validation only (file type/size/duration
checks — no ML) plus a human-in-the-loop safety net (any report
immediately auto-hides a clip, pending best-effort parent/coach email
follow-up). It deliberately does **not** build automated content
classification ("does this clip actually show floorball training, is it
appropriate") — that would need a real video-classification model, its own
Python/uv service (per `docs/adr/0003-package-managers.md`), and a sync-
vs-async latency/cost tradeoff discussion, none of which this phase has
evidence it needs yet at this project's current small-closed-team beta
scale. Revisit if teams stop being small/real-world-known rosters, or if
the report/auto-hide posture proves insufficient in practice — the same
trigger condition `docs/adr/0007-team-chat.md` already states for its own
deferred LLM-moderation item.
