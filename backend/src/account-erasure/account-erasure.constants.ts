// docs/adr/0013-account-erasure.md Decision 3 — 24h, longer than the
// 15-minute norm elsewhere in this app (session-reissue, contact-change):
// this is a materially bigger decision than a single-sitting action; a
// family should be able to read it, think about it overnight, and come
// back, not be forced to act "right now."
export const ERASURE_CONFIRM_CODE_TTL_MS = 24 * 60 * 60 * 1000;

// docs/adr/0013-account-erasure.md Context/Decision 2 — the project
// owner's literal "30 days grace period."
export const ERASURE_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// docs/adr/0013-account-erasure.md Decision 6 — TeamChatMessage rows sent
// by an erased player are anonymized in place (content overwritten,
// sender_player_id set null), never hard-deleted, to preserve the
// remaining team's flat chat feed continuity. A fixed placeholder, not a
// per-message-derived string — there is nothing left worth deriving from
// once the row is anonymized.
export const ERASED_CHAT_MESSAGE_PLACEHOLDER =
  '[Det här meddelandet är borttaget – kontot har raderats]';
