export const EVENT_REGISTRATION_NAME_MAX_LENGTH = 120;
// RFC 5321's practical maximum for a full address.
export const EVENT_REGISTRATION_EMAIL_MAX_LENGTH = 254;
export const EVENT_REGISTRATION_NOTE_MAX_LENGTH = 500;
export const EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH = 64;

/**
 * How long a registration is kept before the daily sweep deletes it.
 *
 * This is a marketing list of adults, held on consent — so it needs a
 * stated retention period rather than living forever by default. A year
 * covers the demo itself plus a follow-up season; anything older has no
 * purpose left, and "we might want it someday" is not a purpose that
 * consent was given for.
 *
 * Longer than the 90 days the error log and bug reports get, and
 * deliberately so: those are operational debugging data with no reason to
 * outlive their usefulness, while this is a person who asked to hear from
 * us and would reasonably expect that to last more than a quarter.
 *
 * Overridable via EVENT_REGISTRATION_RETENTION_DAYS.
 */
export const DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS = 365;
