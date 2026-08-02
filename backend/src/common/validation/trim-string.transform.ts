// class-validator's IsNotEmpty only rejects the exact empty string, not a
// whitespace-only one — trim first, so " " can't slip past IsNotEmpty (and,
// for content this app moderates, the content-safety filter) to become a
// permanently-persisted blank value. Extracted after this exact,
// parameter-free transform was independently reimplemented, byte-identical,
// in five DTOs (create-player, request-session-reissue, update-profile,
// request-contact-change, create-chat-message) — unlike this codebase's
// documented per-DTO length constants (which can legitimately differ by
// field), trimming has no field-specific variation to preserve, so sharing
// it costs nothing the way sharing a business constant sometimes would.
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
