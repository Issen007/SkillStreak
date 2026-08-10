export const EVENT_REGISTRATION_NAME_MAX_LENGTH = 120;
// RFC 5321's practical maximum for a full address.
export const EVENT_REGISTRATION_EMAIL_MAX_LENGTH = 254;
export const EVENT_REGISTRATION_NOTE_MAX_LENGTH = 500;
export const EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH = 64;

/**
 * How long a registration is kept.
 *
 * This is a marketing list of adults, held on consent — so it needs a
 * stated retention period rather than living forever by default. A year
 * covers the demo itself plus a follow-up season; anything older has no
 * purpose left and should go.
 *
 * Not yet enforced by a sweep (see the module docstring) — the admin
 * delete endpoint is what satisfies an erasure request today.
 */
export const EVENT_REGISTRATION_RETENTION_DAYS = 365;
