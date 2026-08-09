# Fas 8 Flows — the PT (Personal Trainer) role, end to end

Design pass for `docs/adr/0023-pt-role-and-staff-sso-rbac.md` Part A and
Part B. Written 2026-08-09.

**The backend for both parts is already built and tested.** Every endpoint
named here exists today; nothing in this document asks for a new one, and
where a design want would have required one it is listed in §11 as a
flagged ask rather than assumed. That inverts the usual order and is worth
stating up front: this doc's job is to draw screens onto an API that has
already made its decisions, not to negotiate with it.

---

## Scope — and what this is explicitly not

**Seven surfaces, three audiences, two clients.**

| # | Surface | Audience | Client |
|---|---|---|---|
| PT1 | Team-link redemption | PT | Web (staff console) |
| PT2 | My teams / roster | PT | Web |
| PT3 | Request consent for a player | PT | Web |
| PT4 | A player's numbers (read-only) | PT | Web |
| FAM1 | Review-and-approve a PT request | Parent, or 13+ player | Web (mailed link, no login) |
| PL1 | Manage my PT relationships | Player | Mobile |
| CAP1 | Invite / revoke a PT | Captain | Mobile |
| AD0′ | Admin login — password form → SSO buttons | Admin | Web |

**Not in scope, deliberately:**

- **Any PT-authored content.** A PT cannot write anything into this app —
  no messages, no challenges, no notes on a player. ADR-0023 gives the role
  read access and nothing else, and no screen here has a compose affordance
  to accidentally imply otherwise.
- **Anything a PT could see about a player without approved consent.**
  Covered structurally by §3's tier split; called out here so a reviewer can
  check this doc against A5's allow-list line by line.
- **PT self-signup.** A `StaffAccount` is provisioned entirely by SSO
  (Decision A7/B1); there is no registration screen to draw.
- **Video, chat, real names, contact addresses.** Never visible to a PT, at
  any tier. See §3.

---

## 0. The one idea the whole design hangs on

**A PT's access is two gates deep, and the second one is per child.**

```
   captain generates code            PT redeems it
   ────────────────────────►  ┌──────────────────────┐
                              │  PtTeamLink: active  │
                              └──────────┬───────────┘
                                         │  grants ONLY:
                                         │  team name, pot totals,
                                         │  weekly-goal progress,
                                         │  roster SCREEN NAMES,
                                         │  each player's consent status
                                         ▼
                          PT requests one specific player
                                         │
                              ┌──────────▼───────────┐
                              │ PtPlayerConsent:     │
                              │ pending_review       │──── parent (or 13+ self)
                              └──────────┬───────────┘     declines → nothing
                                         │ approved
                                         ▼
                              streaks, training log,
                              badge key/name/date
```

Every screen below is a view onto one of those two states, and the design's
main job is making the boundary *legible* — to the PT (so they understand
why a name is greyed out), to the family (so they understand exactly what
they are approving), and to the player (so they can see and end it).

**The interface must never imply the first gate granted more than it did.**
That is the single most likely way this design could go wrong: a roster
list that looks like a dashboard invites the PT to read it as "my players",
when in fact it is "people who exist, most of whom I may not look at."

---

## 1. Visual register

PT1–PT4 and AD0′ are **web**, and reuse the admin console's register
established in `phase7-admin-console-flows.md` §1 — system font stack,
dense tables, no youth-facing playfulness. A PT is an adult doing work.

FAM1 is **web but not console** — it reuses the existing consent-page
templates' register (`backend/src/consent/consent-page.templates.ts`,
`pt-consent-page.templates.ts`): single-column, large type, one decision,
no navigation. A parent reaching it from an email is not "using an app."

PL1 and CAP1 are **mobile**, and reuse the app's own youth register per
`style-guide.md` — with one deliberate exception noted in §8.

---

## 2. PT1 — Team-link redemption

**Entry:** a PT signs in via SSO and has no active `PtTeamLink`. This is
the empty state of PT2, not a separate route — a PT with zero teams sees
the redemption card as the whole page.

**API:** `POST /api/v1/pt/team-links/redeem { code }`

```
┌──────────────────────────────────────────────────┐
│  Ansluten som  anna@ptstudio.se        [Logga ut]│
├──────────────────────────────────────────────────┤
│                                                  │
│   Du är inte kopplad till något lag ännu.        │
│                                                  │
│   En lagkapten ger dig en kod. Skriv in den      │
│   här för att se lagets sidor.                   │
│                                                  │
│   ┌────────────────────────┐                     │
│   │  A B 3 K – 7 M 2 P     │   [ Anslut ]        │
│   └────────────────────────┘                     │
│                                                  │
│   Koden gäller i 24 timmar och kan bara          │
│   användas en gång.                              │
└──────────────────────────────────────────────────┘
```

**Input treatment.** 8 characters from `generateHumanCode`'s
visually-unambiguous alphabet. Uppercase as typed, accept lowercase and
spaces, strip separators before submit. Do **not** mask it — this is a
shared code, not a secret the typist must be protected from seeing.

| State | Copy | Notes |
|---|---|---|
| `idle` | as drawn | Submit disabled until 8 chars |
| `submitting` | button → spinner | Input locked |
| `409 invite_code_invalid` | *"Koden stämmer inte, eller har redan använts. Be kaptenen om en ny."* | Deliberately does not distinguish wrong / used / expired — same generic posture as every other code in this app |
| `409 pt_team_link_already_active` | *"Du är redan kopplad till det här laget."* | Not an error state visually; route straight to PT2 |
| `403 not_pt_role` | *"Det här kontot har inte tränarbehörighet."* | An admin-role account that wandered here |
| network | *"Något gick fel. Försök igen."* | Retry preserves the typed code |

**Why no "request access to a team" flow.** The PT cannot initiate. That
is Decision A2's whole shape — the team invites, never the reverse — and
adding a "find my team" search would hand a PT exactly the cross-app
player-scanning ability A2 closes at the authorization layer.

---

## 3. PT2 — My teams / roster

**API:** `GET /api/v1/pt/team-links`, then
`GET /api/v1/pt/players/:playerId/consent-status` per row (or the roster
payload's embedded status — see §11's first ask).

```
┌──────────────────────────────────────────────────────────────┐
│  IFK Lundby P13                                    [Lämna]   │
│  Lagpott 4 210 / 10 000 p   ·   Veckomål: 12 av 18 pass      │
├──────────────────────────────────────────────────────────────┤
│  Spelare (14)                                                │
│                                                              │
│  ● FloorballStar15      Godkänd          [ Visa siffror ]    │
│  ● SnabbaBen07          Godkänd          [ Visa siffror ]    │
│  ○ Klubban22            Väntar på svar   — skickad 2 dagar   │
│  ○ Nummer9              Ingen tillgång   [ Fråga om lov ]    │
│  ○ Målvakten01          Ingen tillgång   [ Fråga om lov ]    │
│  ○ Rocket88             Nekad            — kan frågas igen   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**The status column is the point of this screen.** Three of the four states
are "you may not look at this child", and the design leans into that
rather than hiding it: greyed rows, no affordance that looks like a link,
and the action button is *"Fråga om lov"* ("ask permission") — not "add"
or "connect", which would frame consent as a formality.

| `PtPlayerConsent.status` | Row label (sv / en) | Action |
|---|---|---|
| none (no row) | Ingen tillgång / No access | **Fråga om lov** → PT3 |
| `pending_review` | Väntar på svar / Awaiting reply | none; show relative age of the request |
| `approved` | Godkänd / Approved | **Visa siffror** → PT4 |
| `declined` | Nekad / Declined | **Fråga om lov** (re-ask allowed) |
| `revoked` | Avslutad / Ended | **Fråga om lov** (re-ask allowed) |

**Re-asking after a decline is allowed but not encouraged.** The backend
permits a new request; the UI does not surface a prominent button for it,
and a second request to the same player within 7 days shows an inline
caution: *"Du frågade nyligen. Fråga bara igen om något har ändrats."*
This is a UI-side courtesy, not an enforced limit — see §11.

**What is deliberately absent from every roster row**: real name, contact
address, birth year, any streak number, any badge, any indication that the
player has *other* PT relationships. That last one is the easiest to add by
accident and is explicitly never exposed (A5).

**Team-aggregate figures are shown to any active link**, no per-player
consent needed — pot total, goal threshold, weekly-goal progress. These are
team-wide by construction and already visible to every teammate.

**`[Lämna]`** revokes this PT's own team link — the PT's own exit. It is
not one of A4's three levers (those are player / parent / captain); it is
simply the PT declining to hold access they no longer need, and it is
correct to offer. Confirm inline: *"Du förlorar tillgång till hela laget.
Du kan bli inbjuden igen."*

---

## 4. PT3 — Request consent for a player

**API:** `POST /api/v1/pt/players/:playerId/consent-requests`

A modal over PT2, not a route. One decision, and the screen's real job is
to tell the PT what the family is about to be asked — so the PT
understands the request is a real imposition on a family's inbox, not a
button that "adds a player."

```
   ┌──────────────────────────────────────────────┐
   │  Fråga om lov att se Nummer9s siffror   [✕]  │
   │                                              │
   │  Vi skickar ett mejl till spelarens          │
   │  målsman. Hen bestämmer.                     │
   │                                              │
   │  Om det godkänns ser du:                     │
   │    • streak och längsta streak               │
   │    • loggade pass (typ och minuter)          │
   │    • märken spelaren fått                    │
   │                                              │
   │  Du ser aldrig:                              │
   │    • namn eller kontaktuppgifter             │
   │    • chatt eller klipp                       │
   │                                              │
   │           [ Avbryt ]   [ Skicka frågan ]     │
   └──────────────────────────────────────────────┘
```

**The "Du ser aldrig" list is not decoration.** It is the same list the
family sees in FAM1, shown to the PT first, so both sides of the
transaction are looking at identical terms. If those two lists ever drift
apart in a future edit, that is a bug.

| State | Copy |
|---|---|
| `201` | Toast: *"Frågan är skickad."* Row flips to Väntar på svar |
| `403 no_active_team_link` | *"Din koppling till laget har avslutats."* Reload PT2 |
| `409 pt_consent_already_pending` | *"Du har redan en obesvarad fråga för den här spelaren."* |
| `429` | *"Du har skickat många frågor. Vänta en stund."* |

---

## 5. PT4 — A player's numbers (read-only)

**API:** `GET /api/v1/pt/players/:playerId` — 403s the moment consent is
not live, on every request, with no propagation delay (A4).

```
┌──────────────────────────────────────────────────────────────┐
│  ← Tillbaka till IFK Lundby P13                              │
│                                                              │
│  FloorballStar15                                             │
│  Godkänd sedan 12 juni 2026                                  │
│                                                              │
│  ┌────────────┬────────────┬────────────────────┐            │
│  │ Streak     │ Längsta    │ Senast tränade     │            │
│  │ 12 dagar   │ 31 dagar   │ igår               │            │
│  └────────────┴────────────┴────────────────────┘            │
│                                                              │
│  Loggade pass                                                │
│  ┌──────────────┬───────────────┬──────────┐                 │
│  │ 8 aug        │ Innebandy     │ 45 min   │                 │
│  │ 7 aug        │ Löpning       │ 20 min   │                 │
│  │ 5 aug        │ Kondition     │ 15 min   │                 │
│  └──────────────┴───────────────┴──────────┘                 │
│                                    [ Visa fler ]             │
│                                                              │
│  Märken                                                      │
│   🔥 Bäst kämpaglöd    ·  2 aug                              │
│   🎯 Mest kreativa övning  ·  24 juli                        │
└──────────────────────────────────────────────────────────────┘
```

**Badges show `displayName` and `awardedAt` only.** Never
`BadgeAward.context`, which carries a coach's freeform note — excluded by
A5 explicitly, and the single most likely field for a UI to pick up by
accident because it renders nicely.

**No chart, deliberately.** A sparkline over training frequency would be
genuinely useful and is genuinely tempting; it is also a new derived view
of a child's behaviour over time, which A5's allow-list did not argue for.
Flagged in §11 rather than drawn.

**Revocation is not an error.** If the relationship ends while the PT has
this page open, the next request 403s and the page replaces itself with:

> **Du har inte längre tillgång till den här spelaren.**
> Familjen eller laget har avslutat kopplingen.
> [ Tillbaka till laget ]

Neutral, non-accusatory, no detail about *who* ended it or why — the PT is
not owed that, and A5 excludes it.

---

## 6. FAM1 — Review and approve (parent, or 13+ player)

**The most consequential screen in this phase.** A parent who has never
seen this app opens an email and must decide whether an adult they may not
know gets to watch their child's training data.

**API:** `GET /api/v1/pt-consent/:reviewCode` (preview, no side effects),
`POST .../approve`, `POST .../decline`. Server-rendered, no login, matching
every other mailed-link action in this app.

```
┌────────────────────────────────────────────────────┐
│                                                    │
│   Anna Svensson vill kunna se                      │
│   FloorballStar15s träning                         │
│                                                    │
│   Anna är kopplad till laget IFK Lundby P13        │
│   av lagets kapten.                                │
│                                                    │
│   ─────────────────────────────────────────────    │
│                                                    │
│   Om du godkänner ser Anna:                        │
│     • hur många dagar i rad spelaren tränat        │
│     • loggade pass — typ av träning och minuter    │
│     • märken spelaren fått                         │
│                                                    │
│   Anna ser aldrig:                                 │
│     • spelarens riktiga namn                       │
│     • din eller spelarens mejladress               │
│     • chatt, klipp eller foton                     │
│                                                    │
│   Du kan ångra dig när som helst — både du och     │
│   spelaren kan avsluta det här direkt i efterhand. │
│                                                    │
│        [ Nej tack ]        [ Godkänn ]             │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Copy decisions worth defending:**

- **The PT is named, and so is who brought them in.** "kopplad till laget
  … av lagets kapten" — a parent's first question is "who is this person
  and why do they have anything to do with my kid's team", and the answer
  is available (`PtTeamLink.invited_by_player_id`). Note it is the *fact* of
  captain-invitation that is shown, not the captain's identity, which no
  screen here has a reason to publish to another family.
- **"Anna ser aldrig" comes before the buttons, not in a footnote.** The
  exclusions are the reassurance that makes an approval informed.
- **Reversibility is stated on the decision screen**, not only in the
  confirmation email. A parent hesitating over a permanent-feeling grant
  should be told, before deciding, that it isn't permanent.
- **No default, no pre-selection, equal visual weight on both buttons.**
  Declining is not a failure path.

**Post-decision states:**

| Action | Page | Email |
|---|---|---|
| Approve | *"Klart. Anna kan nu se FloorballStar15s träning."* + a plain-language line that a link to end it has been emailed | Confirmation **with the non-expiring `revoke_code` link** |
| Decline | *"Tack. Anna får inte se spelarens träning."* No further action offered | Nothing to the family; the PT sees `declined` |
| Expired / used code | *"Den här länken gäller inte längre."* + *"Be tränaren skicka en ny fråga."* | — |

**The 13+ self-verified case** reuses this exact page with pronoun-adjusted
copy (*"vill kunna se din träning"*, *"Om du godkänner ser Anna…"*), routed
by the same age-band logic that already decides where the initial account
consent email goes. It is the same decision with the same stakes; drawing a
separate, softer screen for a 13-year-old would be the wrong instinct.

---

## 7. PL1 — Manage my PT relationships (mobile)

**Where:** Profile → *"Mina tränare"*. Only rendered when the player has at
least one non-`none` PT relationship, current or past — this is not a
concept every child needs to meet.

**API:** `POST /api/v1/players/me/pt-consents/:id/revoke`

```
   Mina tränare
   ─────────────────────────────────

   Anna Svensson              Aktiv
   Ser din träning sedan 12 juni
                        [ Avsluta ]

   Jonas Berg              Avslutad
   Avslutades 2 augusti


   Det är alltid ditt val. Du kan
   avsluta direkt, utan att fråga
   någon.
```

**The closing line is the point of the screen.** A4 gives the child an
unconditional, immediate, no-parent-needed lever, and a lever a child
doesn't know exists is not self-determination. The wording is deliberately
plain and non-alarming — this is a normal thing to do, not an emergency
exit.

**Confirm sheet:**

> **Avsluta med Anna Svensson?**
> Anna kommer inte längre se din träning.
> Du kan säga ja igen senare om du vill.
> [ Avbryt ] [ Avsluta ]

No warning iconography, no red. Ending a relationship is not destructive
and should not be dressed as though it were.

---

## 8. CAP1 — Invite / revoke a PT (mobile, captain)

**Where:** Laget → *"Tränare"*, captain-only.

**API:** `POST /api/v1/teams/:teamId/pt-links/invite`,
`GET /api/v1/teams/:teamId/pt-links`,
`POST /api/v1/teams/:teamId/pt-links/:id/revoke`

```
   Tränare
   ─────────────────────────────────

   Anna Svensson             Aktiv
   Med sedan 3 juni
                     [ Ta bort ]

   ─────────────────────────────────
   [  Bjud in en tränare  ]
```

Invite generates and displays the code with a share affordance:

```
   Ge den här koden till tränaren

        A B 3 K – 7 M 2 P

   Koden gäller i 24 timmar.
        [ Dela ]   [ Klar ]
```

**The one deliberate register exception.** Revoking a team link cascades —
it ends *every* family's approved consent under that link, at once (A4
lever 3). That is a captain acting on other families' behalf, and it is the
only action in the youth-facing app with that property. So this confirm,
alone, is explicit about the blast radius:

> **Ta bort Anna Svensson?**
> Anna slutar direkt se **alla** spelares träning i laget — även de som
> sagt ja.
> Familjerna får inget mejl om det här.
> [ Avbryt ] [ Ta bort ]

The second line exists because its absence would be a surprise: a parent
who approved a PT will simply find the relationship gone. Whether that
silence is right is §12's first open question.

---

## 9. AD0′ — Admin login: password form → SSO buttons

`phase7-admin-console-flows.md` §3 drew AD0 as a username/password form.
**That form cannot exist** — ADR-0023 Part B removed app-held staff
credentials entirely. Replacement:

```
┌────────────────────────────────────────┐
│                                        │
│          SkillStreak — Personal        │
│                                        │
│    [  Fortsätt med Google       ]      │
│    [  Fortsätt med Microsoft    ]      │
│    [  Fortsätt med Apple        ]      │
│                                        │
│    Du behöver ett konto som redan      │
│    har behörighet.                     │
│                                        │
└────────────────────────────────────────┘
```

**One screen for both roles.** The same three buttons serve admin and PT;
role is derived server-side from `ADMIN_EMAILS` at callback time, never
chosen by the person signing in. There is no "I'm a trainer" toggle — a
role picker would be a lie, since picking it changes nothing.

**Post-login routing:** `admin` → the console's AD1; `pt` → PT2 (or PT1 when
no active link). A `pt` account landing on an `/admin` deep link gets the
console's existing `not_admin` treatment, not a bespoke screen.

| State | Copy |
|---|---|
| `not_admin` on an admin route | *"Det här kontot har inte administratörsbehörighet."* + [Logga ut] |
| `staff_account_revoked` | *"Kontot är avstängt."* No detail, no appeal path in-product |
| `oauth_callback_rejected` | *"Inloggningen gick inte igenom. Försök igen."* Generic by design |
| `reauth_required` | See §10 |

---

## 10. AD5′ — Step-up re-auth, redrawn

`phase7-admin-console-flows.md` §8 drew this as an inline password modal.
Superseded twice over: there is no password, and the mechanism resolved
(ADR-0022 Decision 10, 2026-08-08) to an **OIDC re-authentication** —
`GET /api/v1/staff-auth/:provider/step-up`, which leaves the app and comes
back.

That round trip breaks §8's central premise that console state is never
unmounted. The replacement premise:

```
   ┌──────────────────────────────────────────┐
   │  🔒  Bekräfta att det är du         [✕]  │
   │                                          │
   │  Den här delen kräver att du loggar in   │
   │  igen. Du kommer tillbaka hit direkt.    │
   │                                          │
   │        [ Avbryt ]  [ Logga in igen ]     │
   └──────────────────────────────────────────┘
```

- The modal no longer collects anything — it explains, and hands off.
- Before navigating, persist the intended destination (e.g.
  `#planning/security-issues`) so the callback can restore it.
- "Du kommer tillbaka hit direkt" is a promise the router must keep; if
  restoration isn't implemented, the copy must change rather than lie.
- **Apple-authenticated admins cannot pass this gate at all** — Sign in
  with Apple ignores `prompt`/`max_age`, so step-up fails closed. They need
  a real dead-end state, not a loop: *"Det går inte att bekräfta med Apple.
  Logga in med Google eller Microsoft för att se den här delen."* This is a
  live limitation, not a hypothetical — see §12.

---

## 11. Flagged for others, not decided here

1. **Roster consent status in one payload.** PT2 renders a per-row status;
   fetching `consent-status` per player is N+1. Either embed the status in
   the roster response or add a bulk read. Backend call.
2. **`birthYear` in the per-player tier — still open**, exactly as A5 left
   it. Design opinion, asked for here: **include it.** A PT designing an
   age-appropriate session is the stated use case, the field is already
   lower-sensitivity by ADR-0002's reasoning, and a birth year without a
   name or contact does not re-identify a child to someone who already
   knows which team they play for. Needs the project owner's yes.
3. **A training-frequency chart on PT4** (§5) — useful, and a genuinely new
   derived view. Wants an explicit A5 amendment before anyone draws it.
4. **The 7-day re-ask caution on PT2** is UI-side only. If repeated
   re-asking after declines turns out to be a real pattern, it needs a
   backend limit; a client-side nudge is not a control.
5. **PT-side i18n scope.** The staff console is English-only per Phase 7's
   §14 recommendation; PT1–PT4 are drawn here in Swedish because a Swedish
   youth-team trainer is the actual user. These conflict. Recommendation:
   **the staff console stays English, the PT surfaces follow the player
   app's 8 locales** — they have different audiences, and one is
   customer-facing.
6. **FAM1 must render in the family's locale**, which the consent flow
   already resolves for the initial account-consent email. Reuse that
   resolution; do not add a second mechanism.

---

## 12. Open questions for the project owner

1. **Should families be emailed when a captain revokes a team link?** (§8)
   Today they are not — a parent who approved a PT finds the relationship
   silently gone. Arguments both ways: silence avoids alarming a family
   about a routine roster change; notification respects that they made an
   explicit decision that someone else has now undone. **Recommendation:
   notify, briefly and unalarmingly** — the family opted in deliberately,
   and the app's posture elsewhere is to tell people when a decision of
   theirs stops applying.
2. **Apple for staff login** (§10). Apple cannot satisfy step-up, so Apple
   admins are locked out of the planning pillar. Options: accept it and
   show the dead-end copy, drop Apple from the staff login screen entirely,
   or restrict Apple to `pt`-role accounts (which never need step-up).
   **Recommendation: restrict Apple to PT accounts** — it keeps the option
   for the larger audience while removing a broken path for admins.
3. **`birthYear`** — see §11.2. A yes or no closes A5's one open field.
4. **Does a PT see a player's team-join status?** Not addressed by A5. A
   pending-join player currently appears in the roster like any other.
   Low stakes, but undecided.

---

## 13. i18n keys

New namespace `pt.json`, all 8 locales (`cs, da, de, en, fi, fr, nb, sv`).
Mobile surfaces (PL1, CAP1) only; web surfaces follow §11.5's resolution.

```
pt.mine.title                     "Mina tränare"
pt.mine.statusActive              "Aktiv"
pt.mine.statusEnded               "Avslutad"
pt.mine.seeingSince               "Ser din träning sedan {{date}}"
pt.mine.endedOn                   "Avslutades {{date}}"
pt.mine.end                       "Avsluta"
pt.mine.yourChoice                "Det är alltid ditt val. Du kan avsluta direkt, utan att fråga någon."
pt.mine.confirmTitle              "Avsluta med {{name}}?"
pt.mine.confirmBody               "{{name}} kommer inte längre se din träning."
pt.mine.confirmAgain              "Du kan säga ja igen senare om du vill."

pt.captain.title                  "Tränare"
pt.captain.invite                 "Bjud in en tränare"
pt.captain.memberSince            "Med sedan {{date}}"
pt.captain.remove                 "Ta bort"
pt.captain.codeTitle              "Ge den här koden till tränaren"
pt.captain.codeValidity           "Koden gäller i 24 timmar."
pt.captain.share                  "Dela"
pt.captain.removeTitle            "Ta bort {{name}}?"
pt.captain.removeBody             "{{name}} slutar direkt se alla spelares träning i laget — även de som sagt ja."
pt.captain.removeNoEmail          "Familjerna får inget mejl om det här."

pt.errors.linkGone                "Din koppling till laget har avslutats."
pt.errors.generic                 "Något gick fel. Försök igen."
```

`pt.captain.removeBody` carries the `**alla**` emphasis in §8 — the
markup lives in the component, not the string, matching this app's
existing convention.

---

## 14. Accessibility

- Consent status on PT2/PL1 is **never colour alone** — every row carries a
  text label. Colour-blind users and greyscale printouts of a roster both
  read correctly.
- FAM1 is reachable and completable with keyboard only, at 200% zoom, in a
  single column. Parents skew older than the app's users.
- The approve/decline buttons in FAM1 have equal size, contrast and tab
  weight. A visually dominant "Godkänn" would be a dark pattern on a
  consent screen.
- Code inputs (PT1) accept paste and are not split into per-character
  boxes, which break screen readers and paste alike.
- PT4's tables use real `<th scope>` headers, not styled divs.

---

## 15. Implementation checklist

- [ ] PT1–PT4 (web, staff console) — new routes under the existing console shell
- [ ] FAM1 — server-rendered template beside `pt-consent-page.templates.ts`; locale from the family's resolved locale
- [ ] PL1 — Profile → Mina tränare, conditional on ≥1 relationship
- [ ] CAP1 — Laget → Tränare, captain-only
- [ ] AD0′ — replace §3's password form; delete the form, don't hide it
- [ ] AD5′ — replace §8's password modal; persist and restore the destination
- [ ] `pt.json` × 8 locales
- [ ] Resolve §12's four questions before PT4 and CAP1 ship
