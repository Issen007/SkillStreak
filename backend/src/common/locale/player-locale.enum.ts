// docs/adr/0014-multi-language-support.md Decision 1 — the one place this
// enum is defined, imported by Player (backend/src/players/entities/
// player.entity.ts), every mail/consent-page template, and both DTOs that
// accept a locale (CreatePlayerDto, UpdateProfileDto), so mobile, Player,
// and mail code all agree on one type.
//
// Deliberately a fixed 8-value enum, not a freeform BCP-47 tag — see the
// ADR's Decision 1 for the full reasoning. Widened from the original
// 5-value set (sv/en/fi/da/nb) to 8 per the project owner's 2026-08-01
// correction/expansion, adding de/cs/fr — decided before any translation
// content exists, so this ships as the real target set from day one
// rather than a second migration later. `nb` (Bokmål), not `no` (an
// ambiguous macrolanguage code) or a region-tagged `nb-NO`; `de` is one
// single locale covering Switzerland/Austria/Germany, not three — no
// region subtag anywhere in this enum, on purpose (see the ADR's
// Decision 5 / CLAUDE.md's no-location-tracking constraint).
export enum PlayerLocale {
  SV = 'sv',
  EN = 'en',
  FI = 'fi',
  DA = 'da',
  NB = 'nb',
  DE = 'de',
  CS = 'cs',
  FR = 'fr',
}
