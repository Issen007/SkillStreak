# Phase 6 — Public Shorts feed, reactions & Archive (UX flows)

**Design pass, 2026-08-19.** Nothing here is built. Deliverable of the
`ux-designer` item under Phase 6 in `docs/internal/ACTION_PLAN.md`.

Design of record for the feature: `docs/adr/0019-public-shorts-feed.md`
(as amended by its 2026-08-07 security pass) and
`docs/adr/0030-revocable-public-sharing-consent.md` (which temporarily
replaces ADR-0019's per-clip gate — see §2). Visual language:
`docs/design/style-guide.md`.

---

## 1. The two hard gates — status, because one is still open

ADR-0019's security pass named two prerequisites that are **not the
designer's or the developer's to close**. Their status as of today:

| Gate | Status |
|---|---|
| The project owner amends CLAUDE.md's closed-team-bubble sentence | ✅ **Closed 2026-08-18.** Amended to permit *a player's own clips, while that player's own parent has an active public-sharing consent*. |
| The consent-copy correction, across six surfaces | ❌ **OPEN.** |

### The open one carries a trap, and it is worth stating loudly

Six surfaces still promise that clips never leave the team. The most
direct is the **Shorts feature's own in-app explainer, shown to the
child** — `mobile/src/i18n/locales/*/clips.json` → `v0.bullet1`,
verified still present in **all 8 locales** on 2026-08-19:

> sv: *"Bara ditt eget lag ser Shorts-videorna som laddas upp här."*
> en: *"Only your own team can see the Shorts videos uploaded here."*

That sentence is **still true today**, and only because
`PUBLIC_SHARING_ENABLED_TEAM_IDS` is empty. It becomes false the moment
one team id is added to that ConfigMap — **with no code change, no
deploy, and no warning**. An operator widening a rollout would not
plausibly connect the two.

**So the sequencing constraint is not "before this feature ships", it is
"before the first team is allow-listed."** That is earlier than it
sounds, and it is the single most important line in this document. It
should be treated as part of the allow-list runbook, not as a
documentation chore that trails the build.

The other five surfaces are listed in ADR-0019's Consequences: the
consent page's `CONSENT_CONFIRM_COPY` **and** `SELF_VERIFICATION_CONFIRM_COPY`
(16 strings, not 8), the ToS draft §1.1/§1.2/§5, the code-of-conduct
draft §5, and the parental-consent email template.

---

## 2. Two publishing models, and which one is real today

This is the thing most likely to be got wrong by whoever builds it, so
it is stated before any screen.

**Interim (what the backend enforces today, per ADR-0030):** a child
publishes a clip themselves, directly. The gates are, in the order the
server checks them:

1. the clip is theirs;
2. their **team** is in `PUBLIC_SHARING_ENABLED_TEAM_IDS`;
3. the clip's status is `published` (not hidden, not still uploading);
4. their **parent's account-level public-sharing consent is `active`**.

There is no per-clip parent approval. Consent is a standing state the
parent can revoke at any time, and revoking it does not merely stop
future publishing — it is designed to take existing public clips down
with it.

**Target (ADR-0019 Decision 1, deferred):** each clip gets its own
parent review — the parent sees *that specific clip* before approving
it. ADR-0030 records the interim swap plainly as *"a reduction in
control"*.

**Consequence for this design:** every screen below is drawn for the
interim model, because that is what will actually run. §9 designs the
per-clip review page separately, because the ux-designer item explicitly
owns two of its requirements and they should not be reinvented later.
Screens that differ between the two models say so.

---

## 3. Where this lives — the Shorts tab gains a second surface

Shorts today is one screen: the team clip feed. It becomes two tabs.

```
┌─────────────────────────────────┐
│  Shorts                         │
│  ┌───────────┐ ┌─────────────┐  │
│  │  Utforska │ │   Arkiv     │  │   ← segmented control, not bottom tabs
│  └───────────┘ └─────────────┘  │
│                                 │
│           (content)             │
└─────────────────────────────────┘
```

**Why a segmented control rather than a third bottom-tab.** The bottom
bar is the app's top-level map and is already at its comfortable limit;
more importantly, "the public feed" and "my archive" are two views of
one idea (clips) and belong under one roof. This also keeps the public
feed **one deliberate tap away from the default**, rather than the thing
the app opens on — which matters for a feed of other people's children.

**Default tab: Arkiv, not Utforska.** Opening straight into an endless
scroll of strangers is the pattern the four reference apps use, and it
is the one this app should not copy. A child arrives in their own and
their team's material and chooses to go outward.

---

## 4. Screen F1 — Utforska (the public feed)

Full-bleed vertical pager, one clip per screen, swipe up for the next —
the mechanic the request asked for and the only part of the reference
apps being borrowed.

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│          [ video fills          │
│            the screen ]         │
│                                 │
│                                 │
│                          ╭────╮ │
│                          │ 🔥 │ │  ← reaction rail, right edge
│                          │ 💪 │ │
│                          │ 🎯 │ │
│                          │ 👏 │ │
│                          ╰────╯ │
│                          ╭────╮ │
│                          │ 🔖 │ │  ← save to archive
│                          ╰────╯ │
│                          ╭────╮ │
│                          │ ⚑  │ │  ← report
│                          ╰────╯ │
│  FloorballStar15                │  ← screen name only
│  Kreativ dribbling · 12 s       │  ← caption, duration
└─────────────────────────────────┘
```

### What a public card shows, and what it must never show

| Shown | Never shown | Why |
|---|---|---|
| Screen name | Real name | CLAUDE.md anonymisation |
| Caption | **Team name** | ADR-0019 Decision 3 — identifiable child + a team name that often encodes a club and location is the de-anonymisation risk the closed bubble exists to prevent. The public-feed query never joins `Team` at all. |
| Duration | **Tagged teammate** | Decision 3 — a tag was made under an assumption of team-only visibility; publishing must not out a *second* child who approved nothing. |
| Whether **you** reacted | **Reaction totals** | See §5. |
| — | Any streak, level, badge or points | None of it is needed to watch a clip, and all of it invites comparison between strangers' children. |

**No profile navigation.** A screen name on the public feed is not
tappable. There is no public profile, no "more from this player", no
follow. Every one of those is a relationship-building affordance between
children who do not know each other, which is exactly the thing this
app's team-bubble model exists to avoid. Stated here as a design
decision so it is not later added as an obvious convenience.

**No share-outside-the-app affordance.** No system share sheet, no copy
link, no download. ADR-0019 Decision 2 bounds "public" to *authenticated
players*; there is no URL that would survive leaving the app, and the UI
must not imply otherwise.

---

## 5. Screen F2 — reactions

ADR-0019 Decision 4 fixes the shape (a small closed vocabulary, never
freeform text) and leaves the vocabulary and copy to this pass.

### The vocabulary

| Reaction | sv label | en label | Chosen because |
|---|---|---|---|
| 🔥 | Snyggt! | Nice one! | General approval, the lowest-effort tap |
| 💪 | Starkt! | Strong! | Effort, not outcome — the app's own ethos |
| 🎯 | Kreativt! | Creative! | Mirrors the "Most creative drill" badge |
| 👏 | Bra jobbat! | Well done! | Encouragement with no skill claim |

Four, not more: every one is unambiguously positive, none can be read as
mockery, and there is no negative or ironic option. A closed vocabulary
means **there is no sentence a reaction can form**, which is precisely
why Decision 4 chose it — the bullying surface is removed by
construction rather than filtered.

One reaction per viewer per clip; tapping a different one replaces it
(the `UNIQUE (clip_id, player_id)` the ADR specifies). Tapping the same
one again clears it.

### The counts decision — reactions are visible to the uploader, not to the crowd

**On the public feed, a viewer sees only their own reaction state.** No
totals, no "127 🔥", no ranking of clips by reaction volume.

**In their own Archive, the uploader sees their clip's totals.**

This is a deliberate departure from all four reference apps and it is
the most consequential product call in this document, so the reasoning
is explicit:

- The owner's request was to publish a clip **"to get reactions"** — that
  is satisfied by the uploader seeing them. It does not require the
  count being public.
- A visible count on a child's face and voice, ranked against other
  children's, is a popularity metric. This app already refused that
  shape once: ADR-0016 buckets leaderboard counts rather than exposing
  exact ones, for fairness reasons that apply with far more force to
  video of a child than to a points total.
- The app's whole premise is pulling children away from
  TikTok/Snapchat/Instagram — importing those apps' central engagement
  mechanic would be adopting the thing it was built to be an alternative
  to.
- It removes any incentive to farm the feed, which the backend already
  partly guards (re-publishing keeps the original timestamp rather than
  jumping to the top).

**Flagged for the project owner as a real product call, not assumed.**
If you want public counts, it is a small change here and a field on the
serialization — but it should be a decision, and the argument above is
what it would be overriding. §11, Q1.

---

## 6. Screen F3 — reporting a public clip

The rail's ⚑ opens a sheet. Reporting a stranger's clip must be at
least as easy as reacting to it, and it is the only affordance on the
public feed with more weight than a tap.

```
Anmäl klippet
─────────────────────────────
Varför anmäler du det här?

○  Det känns otäckt eller elakt
○  Någon är med utan att vilja det
○  Det hör inte hemma i appen
○  Något annat

[ Skicka anmälan ]        [ Avbryt ]
```

Fixed reasons, no freeform text — the same reasoning as reactions, and
the same reasoning that keeps freeform public comments deferred. The
second option exists because it is the one a child is most likely to
need and least likely to find a word for: *someone is in this who did
not agree to be*.

Per ADR-0019 Decision 4, a report **auto-revokes public visibility
only** — the clip returns to its team, it is not deleted. The reporter
sees a plain confirmation and the clip is removed from their feed
immediately; they are never told what happened to it afterwards, which
would be reporting back on another family's business.

---

## 7. Screen A1 — Arkiv (the default tab)

Three collections, one segmented row. ADR-0019 Decision 6 is emphatic
that only the third is a new entity; the first two are views over the
existing team feed.

```
┌─────────────────────────────────┐
│  ┌────────┐ ┌───────┐ ┌───────┐ │
│  │ Laget  │ │ Mina  │ │Sparade│ │
│  └────────┘ └───────┘ └───────┘ │
│                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐        │
│  │ ▶   │ │ ▶   │ │ ▶ 🌍│        │  ← 🌍 = currently public
│  └─────┘ └─────┘ └─────┘        │
│  ┌─────┐ ┌─────┐                │
│  │ ▶   │ │ ▶   │                │
│  └─────┘ └─────┘                │
└─────────────────────────────────┘
```

Grid, not a pager — this is browsing your own material, not consuming a
feed. Reuses `docs/design/clip-library-grid.md`'s existing cell.

- **Laget** — the team feed, unchanged. No publish affordance here: you
  may only publish your own clip, and offering the control on a
  teammate's cell would teach the wrong model.
- **Mina** — the same feed filtered to your own uploads. This is the only
  place a clip can be published from.
- **Sparade** — clips you bookmarked from Utforska.

### Sparade re-validates on every open, and says so when something is gone

ADR-0019 Decision 6 requires the archive to re-check publication status
at fetch time and never trust the stored bookmark. That has a visible
consequence and it needs copy, or a child will think the app lost their
things:

> **sv:** "Ett sparat klipp är inte längre delat. Den som gjorde det har
> tagit bort det från Utforska."
> **en:** "A saved clip isn't shared any more. Whoever made it took it
> off Explore."

Shown once, as a quiet row at the bottom of the grid, not per missing
cell. The row is never attributable — it does not say *which* clip
vanished, because that would let a viewer track another child's
un-publish decisions.

---

## 8. Screen A2 — publishing a clip (interim model)

From **Mina**, tapping a clip opens the existing player; the new control
is a single row beneath it.

### The four states of that control

| State | Row shows | Tap does |
|---|---|---|
| Publishable | "Dela utanför laget" + 🌍 | Opens the confirm sheet (A3) |
| Already public | "Delad utanför laget" + "Ta bort delningen" | Un-publishes immediately (§8.3) |
| No parental consent | "Delning är avstängd" + "Be en vuxen slå på det" | Opens the request-consent flow (already shipped) |
| Team not allow-listed | **Row is absent entirely** | — |

**The last row is the important one.** When a team is not in the
allow-list the control is not shown disabled-with-an-explanation — it is
not there at all. A disabled control that says "not available for your
team yet" advertises a feature to a child who cannot have it, invites
"why not us", and puts a coach in the position of explaining a
deployment decision. The absence is the correct affordance.

### A3 — the confirm sheet

This is the moment a child's video leaves the team bubble, and it is the
only place in this design that gets a deliberate speed bump.

```
Dela utanför laget?
─────────────────────────────
Alla som använder SkillStreak
kommer kunna se det här klippet
— inte bara ditt lag.

Ditt namn i appen syns.
Ditt lags namn syns inte.

Du kan ta bort delningen när du
vill, och då försvinner klippet
från Utforska direkt.

[ Ja, dela klippet ]
[ Avbryt ]
```

Three things it does deliberately:

1. **Says what actually changes**, in a child's words — "everyone who
   uses SkillStreak", not "the public feed".
2. **Says what is and is not revealed.** Naming the team-name omission
   out loud is not noise: it is the one protection a child cannot
   otherwise observe, and telling them builds the right mental model for
   a decision they will make again.
3. **Leads with reversibility.** Un-publish being instant is the single
   most reassuring true fact available, and it is what makes a
   considered "yes" reasonable rather than reckless.

No "don't show this again" option. The sheet appears every time.

### 8.3 Un-publishing

One tap, no confirm sheet, no reason, no cooling-off. ADR-0019 Decision
5 and ADR-0030 Decision 2 both require taking something down to be
strictly easier than putting it up; a confirmation dialog on the way out
would be a small betrayal of that.

Toast: **sv** "Klippet är borta från Utforska." / **en** "The clip is off
Explore."

### 8.4 When a parent revokes consent

Revocation is account-level and takes every public clip down with it.
The child is told, once, plainly, and without blame:

> **sv:** "Delning utanför laget är avstängd nu. Dina klipp finns kvar
> i laget."
> **en:** "Sharing outside the team is switched off now. Your clips are
> still in your team."

The second sentence is doing real work. A child whose clips vanish from
Explore needs to know nothing was deleted, or the reasonable conclusion
is that they were punished.

---

## 9. Screen P1 — the per-clip parent review page (target model, not interim)

**Not built in the interim model.** Designed here because the
ux-designer item explicitly owns two of its requirements, and both are
flow constraints rather than styling choices — discovering them later,
mid-build, is how they get watered down.

This is a web page reached from a mailed link, in the same family as the
existing consent and PT pages.

### 9.1 Constraint one — two-step reveal

**The page must not load the video.** Metadata first; the video is
fetched only after an explicit tap.

```
Steg 1 (on load)              Steg 2 (after tap)
┌──────────────────────┐      ┌──────────────────────┐
│ Ditt barn vill dela  │      │ Ditt barn vill dela  │
│ ett klipp            │      │ ett klipp            │
│                      │      │                      │
│ FloorballStar15      │      │ FloorballStar15      │
│ "Kreativ dribbling"  │      │ ┌──────────────────┐ │
│ 12 sekunder          │      │ │   [ video ]      │ │
│                      │      │ └──────────────────┘ │
│ [ ▶ Visa klippet ]   │      │                      │
│                      │      │ [ Godkänn ]          │
│ (Godkänn låses upp   │      │ [ Godkänn inte ]     │
│  när du sett det)    │      │                      │
└──────────────────────┘      └──────────────────────┘
```

**Why**, recorded so nobody "improves" it into an autoplaying page: mail
gateways and corporate link scanners detonate URLs automatically. A page
that fetches the video on load would pull a child's video into a
third-party sandbox with no human involved. The tap is what proves a
person is present.

The approve button is **disabled until the video has been revealed**. A
parent approving a clip they have not seen is the failure this whole
per-clip gate exists to prevent, and a two-step reveal that still allows
blind approval would be ceremony.

### 9.2 Constraint two — the "who else is in this?" question

The reviewer is the only human in the loop who can catch a re-upload of
another child's clip, or a clip with a bystander in it. So the page asks,
and approval is gated on the answer:

```
Innan du godkänner:

☐  Alla som syns i klippet är med i
   samma lag som mitt barn, och alla
   har sagt ja till att vara med.

[ Godkänn ]   ← disabled until ticked
```

A single required checkbox, not a soft reminder. Two properties matter:

- It is **specific**, not a general "I take responsibility". It names the
  two things that are actually being attested — same team, and agreed.
- It is **unticked by default** and blocks the primary action. A
  pre-ticked box, or an approve button that works regardless, would make
  this decoration.

**Residual, stated rather than papered over:** this is an attestation, not
a verification. Nothing in the system can confirm it. It converts an
unexamined risk into a conscious one held by an adult — which is the
most this surface can honestly do, and is the same framing ADR-0019
Decision 9 already uses for the screenshot residual.

### 9.3 Declining

"Godkänn inte" is not a scolding. Confirmation copy:

> **sv:** "Tack. Klippet delas inte utanför laget. Det finns kvar i ditt
> barns lag som vanligt."

---

## 10. Empty, blocked and error states

| Situation | Surface | Copy direction |
|---|---|---|
| Utforska has nothing yet | Feed | "Inget att utforska än. När andra börjar dela klipp dyker de upp här." Never a count of how few. |
| Sharing switched off | Utforska | The tab is still browsable — viewing is not gated on your own consent. Only publishing is. |
| Team not allow-listed | Utforska | **The Utforska tab is hidden entirely.** Same reasoning as the absent publish row: no feature advertised to a child who cannot use it. |
| Saved clip no longer public | Sparade | §7's non-attributable row. |
| Video fails to play | Feed | Reuse the existing player's error + retry, including the 8s watchdog added 2026-08-09. |

---

## 11. Open questions for the project owner

1. **Reaction counts — public or uploader-only?** §5 argues
   uploader-only and designs it that way. Public counts would be a small
   change; the argument above is what it overrides.
2. **Does viewing the public feed need its own parental opt-in?** ADR-0019
   Decision 2's amendment already flags that there is no upper age bound
   and no viewer-role concept anywhere in this app, so a self-registered
   adult is indistinguishable from a child. This design gates
   *publishing* on consent and leaves *viewing* open to any authenticated
   player. That is the status quo the ADR describes, not a new decision —
   but it is the one most worth a second look before the first team is
   allow-listed.
3. **Default tab.** §3 defaults to Arkiv deliberately. Confirm — it is
   the difference between an app that opens on your own team and one that
   opens on strangers.
4. **Does the 13+ self-verified cohort get to publish at all?** They have
   no parent on file by design, and ADR-0030 Decision 10 already refuses
   them a consent. Under the interim model they therefore cannot publish,
   which is correct-by-accident rather than designed. Worth confirming
   that is the intended answer.

---

## 12. Deliberately not designed here

- **Freeform comments.** Explicitly deferred by ADR-0019 Decision 4; not
  drawn, not stubbed, no affordance left for them.
- **Public profiles, following, or any player-to-player link.** §4.
- **Sharing outside the app.** ADR-0019 Decision 2 bounds public to
  authenticated players; no share sheet exists to draw.
- **A moderation queue for public clips.** Reports auto-revoke; the
  admin-console side of that is Phase 7's territory.
- **The mobile screens' pixel layout.** They follow
  `docs/design/style-guide.md` and the existing clip player; this
  document fixes flows, states and copy, not spacing.
