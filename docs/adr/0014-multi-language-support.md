# 0014 - Multi-language support: locale storage & i18n architecture (part a)

## Status

Accepted — 2026-07-30.

## Context

`docs/PROJECT.md`'s Fas 4 item 5 (moved up the roadmap 2026-07-27, direct
from the project owner): players should be able to **choose a language at
onboarding**, in an early version — not bolted on after every screen and
email already exists in Swedish-only. The item explicitly splits into two
separable pieces:

- **(a) the architecture** — a language picker + a stored `locale` field.
  Build early. **This ADR.**
- **(b) the content** — full translation of every screen/email template
  into English, Finnish, Danish, Norwegian. Can follow gradually once (a)
  exists. **Not this ADR** — no translation content is proposed here.

Starting state, confirmed by reading the code before designing this:

- No i18n library exists in `mobile/` yet (only transitive `node_modules`
  internals reference i18n/locale). CLAUDE.md already flagged this app
  will need real i18n, not hardcoded strings, but nothing was chosen.
- Every backend email template (`backend/src/mail/templates/*.template.ts`)
  hardcodes Swedish subject/body text and `lang="sv"`, including the two
  the roadmap item calls out by name: `consent-request-email.template.ts`
  (parent, third-person) and `self-verification-email.template.ts` (13+
  player, first-person, ADR-0002 addendum §2).
- The API's error contract already separates *code* from *message*:
  `AppException`'s `message` is explicitly documented (see
  `mobile/src/api/ApiError.ts`) as "English/dev-facing, not shown verbatim
  to a child" — the mobile client already branches on the stable `code`
  (e.g. `screen_name_taken_in_team`) and renders its own copy. This matters
  for item 4 below: it means validation/error-message localization is
  **already solved** by this existing pattern, not a new problem this ADR
  needs to invent a mechanism for.
- Some notification emails (chat-report, clip-report) go to a **mixed or
  coach-only** audience, not the player/parent — relevant to where this
  ADR's fallback rule does and doesn't reach (see Decision 3).

## Decision

### 1. Where `locale` lives: a column on `Player`, fixed 5-value enum

Add `locale` directly to `Player` (not `PlayerPrivateInfo`). It fails the
"narrow, single-purpose consumer" test that justified moving `real_name`/
`parent_contact` off `Player` in ADR-0002's addendum §1 — locale is read by
practically every player-facing flow (session bootstrap, every outbound
email), the same broad-consumer profile `birth_year` already has and
stayed on `Player` for. It also isn't sensitive personal data in the sense
those fields are.

**Shape: a fixed Postgres enum of the 8 targeted languages, not a
freeform BCP-47 tag.**

**Correction/expansion, 2026-08-01 (project owner directly)**: the
originally-scoped set (`sv`/`en`/`fi`/`da`/`nb`) is widened to 8, covering
all of Scandinavia plus the DACH region and Czechia, decided before any
translation content exists so this ships as the real target set from day
one rather than a second migration later:

```sql
CREATE TYPE player_locale_enum AS ENUM
  ('sv', 'en', 'fi', 'da', 'nb', 'de', 'cs', 'fr');
ALTER TABLE player
  ADD COLUMN locale player_locale_enum NOT NULL DEFAULT 'sv';
```

- `sv`/`fi`/`da`/`nb` — Sweden/Finland/Denmark/Norway (unchanged from the
  original scope).
- `en` — unchanged, kept as the general/fallback option alongside the
  country-specific set (confirmed explicitly, not dropped).
- `de` — **one** locale for Switzerland, Austria, *and* Germany, not three
  — same language, and Decision 1's "no region subtags" rule (below)
  applies here exactly as it does to `nb`: this enum answers "which
  language," not "which country," so DACH doesn't become three near-
  duplicate values.
- `cs` — Czech Republic.
- `fr` — French, added alongside the above at the project owner's request.

This doesn't change any of Decision 1's reasoning — still a fixed enum
matching an actual, deliberately-chosen set (not a freeform tag), still
"exactly as easy to extend later via `ALTER TYPE ... ADD VALUE` as a
freeform tag would be, without the resolution-chain machinery in the
meantime" — only the target set itself grew from 5 to 8 before any code
shipped against the smaller one.

A freeform BCP-47 field would look more future-proof but buys nothing real
here: content is translated by hand, per locale, one template/screen at a
time (that's exactly what part (b) is). Accepting an arbitrary tag lets a
client set a value nothing renders correctly for, and forces a
fallback-*chain* resolution algorithm (`nb-NO` → `nb` → `no` → default)
this app has no use for yet. A fixed enum matching the actual supported set
is the boring option: it's exactly as easy to extend later (`ALTER TYPE
... ADD VALUE`, an additive migration, the same class of change as any
other enum in this schema, e.g. `ParentalConsentStatus`) as a freeform tag
would be, without the extra resolution logic in the meantime.

`nb` (Norwegian Bokmål — the majority written standard) rather than `no`
(a macrolanguage code, ambiguous between Bokmål/Nynorsk) or a region-tagged
`nb-NO`: deliberately no region subtag anywhere in this enum — the point is
"which of 8 languages," and adding region variants would be scope creep
toward exactly the kind of "where is this device" signal CLAUDE.md's
no-location-tracking constraint (see Decision 5) has no business being
adjacent to.

Default `sv` matches today's actual (implicit) behavior, so the migration
backfills every existing row without needing a data decision.

`Coach.locale` is **not** designed here — the roadmap item and this ADR
are scoped to *players*. Flagged as a known follow-up (see Consequences),
not silently dropped: a future coach-dashboard i18n pass would reuse this
same enum (likely renamed something coach-and-player-neutral like
`AppLocale` at that point).

### 2. Mobile: an onboarding language picker + i18next

**New first onboarding screen**, before `O1EnterCode` (call it `O0`, per
`mobile/src/onboarding/OnboardingFlow.tsx`'s existing step-naming
convention). It has to be first, not folded in later: every subsequent
onboarding screen's copy needs to render in whatever the player just
picked, so the choice can't wait until, say, `O5`. `O0` sets the active
i18n language synchronously (local state, no network round-trip) and its
value is what finally gets submitted as `locale` on the `POST /players`
call (`CreatePlayerDto` gains an optional `locale: PlayerLocale` field —
optional so an old app build that hasn't shipped this yet keeps working,
backend default `sv` covers that case).

Before `O0` is answered (and for any pre-auth surface), use the device's
own locale (`expo-localization`) mapped to the nearest of the 8 supported
languages, falling back to `sv` if the device reports something outside
that set — purely as the *pre-selected default* on the picker, never
treated as a silent, permanent choice. Once a player has an authenticated
session, the source of truth flips to the server's stored value.

**Correction, 2026-08-01 (code-critic + security-reviewer, both
independently flagged the same gap)**: the original text here named `GET
/players/me/profile` (ADR-0012) as where that value comes from. That
endpoint is real and does carry `locale` (see Decision 3's `PATCH` note
below, unchanged), but it's only ever fetched when a player opens the
Profile screen — not on every app open, so a returning player would keep
seeing the device's guess, not their saved choice, until they happened to
visit Profile. **The actual restore point is `GET /players/me`**
(`PlayerMeResponse.player.locale`) — the one call `AppShell`'s
`ensureIdentity` already makes on every mount, before any tab renders.
`AppShell` calls `i18n.changeLanguage(me.player.locale)` there,
fire-and-forget, right after resolving `teamId`/`playerId`. `GET
/players/me/profile` still also carries `locale` (needed for the Profile
screen's own edit form, `PATCH .../profile` below), but is no longer the
thing this Decision depends on for the restore itself.

**Library recommendation: `i18next` + `react-i18next` +
`expo-localization`.** This is a genuinely open choice worth surfacing
rather than silently picking:

- *`i18next`/`react-i18next`* (recommended) — the de facto standard for
  React/React Native, first-class Expo support, typed-resource
  augmentation (catches a typo'd or missing translation key at compile
  time — valuable maintaining 8 languages incrementally with no dedicated
  translator on staff), and a `fallbackLng` behavior that directly matches
  this rollout's shape: an unfinished locale's missing keys silently
  render Swedish instead of a blank/broken screen, so part (b) can ship
  one language at a time without ever having a half-translated screen look
  broken.
- *`react-native-localize` + `i18n-js`* — lighter weight, no
  context/hooks, but no compile-time key safety and a more manual
  fallback story; not worth the savings at this app's size.
- *`react-intl` / FormatJS* — heavier ICU-message-format ceremony (rich
  plural/gender rules) than this product needs; nothing in SkillStreak's
  copy currently needs ICU-grade pluralization across all 8 languages.
  Would be over-engineering for what's actually being shipped.

Recommend `i18next`.

**Layout:** `mobile/src/i18n/index.ts` (init, `fallbackLng: 'sv'`) +
`mobile/src/i18n/locales/{sv,en,fi,da,nb,de,cs,fr}.json`. A single flat
resource file per language is fine at this app's current screen count —
splitting into namespaces is premature. Only `sv.json` needs real content
to ship part (a) (it's a direct copy of strings already hardcoded today);
every other locale file starts as an empty object and relies on the
fallback above.

**Explicitly out of scope for part (a):** retrofitting every existing
hardcoded-Swedish screen to `t('key')` calls — that mechanical-but-large
diff, screen by screen, *is* part (b)'s remaining work, not a prerequisite
for shipping the picker. Recommend a small pilot (the `O0` picker itself,
`O6` confirmation, and the home-screen greeting) be wired through
`t()` as part of (a), purely to prove the round trip actually works
end-to-end; the rest follows incrementally.

### 3. Backend email templates: locale-aware without a rewrite

Every `buildXEmail(input)` template function gains a required
`locale: PlayerLocale` field on its input (same enum/type as `Player
.locale`, defined once — e.g. `backend/src/common/locale/player-locale
.enum.ts` — and imported by both the entity and every template, so mobile,
Player, and mail code all agree on one type).

**Fallback pattern, applied identically to every template file:**

```ts
type LocaleCopy = { subject: string; text: string; html: string };
// (or a small builder function per key, if interpolation is needed)

const COPY: Partial<Record<PlayerLocale, LocaleCopy>> = {
  sv: { /* existing, unchanged Swedish copy */ },
  // en/fi/da/nb/de/cs/fr: added incrementally, per part (b)
};

function resolveCopy(locale: PlayerLocale): LocaleCopy {
  return COPY[locale] ?? COPY.sv!; // never renders blank/broken
}
```

This is the whole mechanism: calling any template with `locale: 'en'`
*today*, before anyone has translated it, silently renders the existing
Swedish copy rather than erroring or sending a blank email. That's what
makes this genuinely incremental — every already-shipped template can take
the `locale` plumbing (a small, mechanical signature change) in one pass,
and each language's real translation can land independently later, one
file at a time, without touching call sites again.

**Where `locale` comes from, per call site:**

- **Onboarding** (consent-request / self-verification emails):
  **Correction, 2026-07-31 (security-reviewer, design-review pass)** — the
  original text here claimed there's no `Player` row with a stored locale
  yet at send time, and said to thread the freshly-submitted (optional)
  `dto.locale` into the (required) template param instead. That's wrong for
  this codebase: `OnboardingService.createPlayer`'s transaction commits and
  returns the created `Player` row *before* `buildConsentRequestEmail`/
  `buildSelfVerificationEmail` are called. By send time,
  `result.player.locale` already exists — either the submitted value or the
  column's `DEFAULT 'sv'` — same as any later lifecycle email. **Use
  `result.player.locale`, not `dto.locale`, at this call site too.** This
  avoids threading an optional field into a required param (and whatever ad
  hoc defaulting that would invite), and matches the source the consent web
  page resolves its own locale from (`consentToken` → `Player` lookup,
  `consent.controller.ts`) — same source for the email and the page it
  links to, so the two can't diverge.
- **Every later player-life-cycle email** (contact-change confirm/notify/
  cancel, erasure confirm/cancel, session-reissue): the already-loaded
  `Player` row's `.locale` column. No new query — every one of these flows
  already has the `Player` in hand before it calls `MailService`.
- **Coach-recipient and mixed-audience emails** (chat-report and
  clip-report notifications — `sendReportNotificationBestEffort`'s
  `recipients` array mixes the reported player's parent *and* team coach
  emails in one send; clip-report's coach email is separate but still
  coach-only): **explicitly not solved by this ADR.** Coaches have no
  locale field (see Decision 1), and splitting a single mixed-recipient
  send into per-recipient locales is more surface than this pass needs.
  Recommendation: leave these Swedish-only for now — flagged as a known,
  deliberate gap, not silently dropped, and a natural trigger for the
  `Coach.locale` follow-up noted above if it's ever prioritized.
- **The consent web page** (`consent-page.templates.ts` — what a parent's
  browser opens from the emailed link, not an app screen) should take the
  same `locale` value as its corresponding email, resolved the same way,
  for the same reason: whatever language the email was in, the page it
  links to should match.

### 4. Backend validation/error messages: already solved, no change needed

Confirmed while reading the code for this ADR: `AppException`'s `message`
is already documented as dev-facing English, never shown verbatim to a
player — the mobile client already renders its own copy keyed on the
stable `code` field (`ApiError.code`). That *is* item 4's answer: no
backend change is needed here, only email sending (Decision 3) is a real
server-side locale consumer. The one follow-on note: as part (b)
translates screens, the existing `code → UI copy` mapping used for these
errors should move into the same i18next resource files as everything
else, rather than staying a separate ad hoc mechanism.

### 5. Constraint interactions

No conflict with closed-team-bubbles, anonymization, or the media-consent
gate — a language choice carries no identity, isn't linked to real name,
and doesn't touch media or team visibility.

One genuine touch point worth flagging, not a violation but a
sequencing note for part (b): the consent-request/self-verification email
*is* a GDPR-relevant moment (a parent's or 13+ player's actual consent
decision). If that email is sent in a language the recipient doesn't
confidently read, that's a comprehension risk to the validity of the
consent itself, not just a cosmetic gap — recommend part (b) prioritize
translating those two templates (and the consent web page) ahead of
purely cosmetic screens, once (a) ships.

No location signal is introduced anywhere in this design — reiterating
Decision 1's choice not to use region-tagged locale codes (`nb-NO` etc.):
"which of 8 languages" is not "where is this device," and this ADR is
deliberately built so it never becomes the latter.

## Consequences

- One additive, zero-downtime Postgres migration: `player_locale_enum` +
  `Player.locale NOT NULL DEFAULT 'sv'`. No backfill judgment call needed.
- `CreatePlayerDto` gains an optional `locale` field; `PlayersService`/
  `OnboardingService` persist it at shell-creation time alongside
  `screenName`/`avatarId`. **Correction, 2026-07-31 (security-reviewer)**:
  this field (and `UpdateProfileDto`'s new `locale` field, see below) must
  carry `@IsEnum(PlayerLocale)`, matching every other enum-typed DTO field
  in this backend (`ActivityType`, `WeeklyGoalTargetMetric`,
  `ClipReportReason`, `ChatMessageReportReason`, etc.). Without it, a
  malformed value passes the global `ValidationPipe` and only fails
  downstream at the Postgres enum check — not exploitable (the exception
  filter never leaks a stack trace), but a real, avoidable validation gap
  the original text omitted.
- Every existing mail-template function signature changes (a required
  `locale` param, resolved via the `COPY[locale] ?? COPY.sv` pattern) — a
  small, mechanical diff across the existing template files, with **no**
  translation content required to land it. code-critic should confirm at
  least one template has a test exercising the sv-fallback path (calling
  it with a locale that has no `COPY` entry yet) before this merges.
- Mobile gains one new dependency set (`i18next`, `react-i18next`,
  `expo-localization`), one new onboarding screen (`O0`), and a
  `mobile/src/i18n/` resource-file structure — existing screens are
  otherwise untouched until part (b) migrates them string-by-string.
- `Player.locale` becomes editable post-onboarding via a small addition to
  ADR-0012's existing `PATCH /players/me/profile` endpoint (an optional
  `locale` field alongside `realName`) rather than a new module — reusing
  that ADR's pattern rather than inventing a second profile-edit path.
- Part (b) — the actual translations — becomes an open-ended,
  independently schedulable backlog (one template or screen at a time),
  matching the project owner's explicit "architecture now, content
  gradually" sequencing. Nothing in part (b) requires touching the
  locale-plumbing built here again.
- `Coach.locale` (and therefore fully-localized coach-recipient/
  mixed-audience notification emails) is an explicitly flagged, deliberate
  gap — not designed in this pass, and not silently assumed to not matter.
