// docs/adr/0014-multi-language-support.md Decision 1 — the one place this
// enum is defined, imported by Player (backend/src/players/entities/
// player.entity.ts), every mail/consent-page template, and both DTOs that
// accept a locale (CreatePlayerDto, UpdateProfileDto), so mobile, Player,
// and mail code all agree on one type.
//
// Deliberately a fixed enum, not a freeform BCP-47 tag — see the ADR's
// Decision 1 for the full reasoning. Widened from the original 5-value
// set (sv/en/fi/da/nb) to 8 per the project owner's 2026-08-01
// correction/expansion, adding de/cs/fr. `nb` (Bokmål), not `no` (an
// ambiguous macrolanguage code) or a region-tagged `nb-NO`; `de` is one
// single locale covering Switzerland/Austria/Germany, not three — no
// region subtag anywhere in this enum, on purpose (see the ADR's
// Decision 5 / CLAUDE.md's no-location-tracking constraint).
//
// **Widened again to 9 on 2026-08-20 (project owner's request): `es`.**
// The 8-value comment above used to call itself "the real target set
// from day one rather than a second migration later" — this is that
// second migration, and pretending otherwise would be rewriting history,
// so the original claim stays and this note corrects it. ADR-0014 is
// amended to match.
//
// **`es` is one locale, not `es-ES` plus `es-419`**, which is the same
// no-region-subtag rule `de` already follows. It works here because this
// app addresses a single child as `tú` — identical in Spain and Latin
// America — and the translations deliberately avoid `vosotros`, which is
// the one common form that would have forced a side to be picked.
export enum PlayerLocale {
  SV = 'sv',
  EN = 'en',
  FI = 'fi',
  DA = 'da',
  NB = 'nb',
  DE = 'de',
  CS = 'cs',
  FR = 'fr',
  ES = 'es',
}
