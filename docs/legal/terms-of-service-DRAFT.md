# SkillStreak — Terms of Service (WORKING DRAFT)

> ## ⚠️ THIS IS A NON-LEGAL WORKING DRAFT — NOT REVIEWED BY A LAWYER
>
> This document was written by the project's UX designer (with an AI coding
> agent) as a **starting point**, grounded in what the app actually does
> today, so that a real lawyer and the project owner have something
> concrete to react to instead of a blank page. It is **not**:
>
> - A finished, legally binding Terms of Service.
> - Reviewed, drafted, or approved by a lawyer.
> - Suitable for a real public launch as-is.
> - A source of legal advice for the project owner, for parents, or for
>   anyone else.
>
> It fabricates no specific legal claims (e.g. "you agree to arbitration
> in X"), but it does make plain-language promises about what the app does
> — those promises are only as good as the engineering behind them (cited
> throughout, by ADR number, so they can be checked). **Do not publish this
> as a real Terms of Service, and do not treat anything below as
> confirmed by a lawyer, until it has actually been reviewed by one** —
> including, at minimum, the open questions listed in the "Open legal
> questions — not resolved here" section at the end.
>
> This same "real draft, not yet reviewed, not yet launch-ready" posture is
> already how this project treats other business documents it hasn't
> written yet (see `docs/BACKLOG.md`'s business-plan item) — this is the
> same thing, for legal copy instead of financial content.

---

## 0. What this app is, right now

SkillStreak (a **working title** — the final app name is still an open
decision, see `docs/PROJECT.md`'s banner) is a real, live beta app built
for youth floorball (innebandy) teams. It is currently running on a real
Kubernetes cluster with real users, not a prototype or a mockup — but it
is still **beta / early access software**, actively changing, and this
Terms of Service should be read with that in mind (see Section 3).

The app has two connected parts:

- An **individual training streak** — a player logs that they trained
  (10-15 minutes of fitness, floorball drills, or running), and builds up
  a personal daily streak.
- A **team point pool** — every logged session also adds points to the
  player's whole team's shared pool, working together toward a team goal
  ("VM-Guld").

It also includes a team-only chat, a team-only short video clip feed,
auto-awarded badges, and (for coaches) a training-plan tool. Every one of
these is scoped to a single closed team — never public, never
cross-team — described in more detail below.

---

## 1. Who can use this app, and how an account is created

### 1.1 Teams are closed, invite-only bubbles

There is no public directory of teams or players. A player joins **one
specific team** using that team's private invite code, given to them by
their coach. Nobody can browse, search, or discover this app's teams,
players, or content from outside — a team is only ever reachable by
someone who already has its invite code. This is a structural property of
how the app is built, not just a setting that could be quietly changed
later.

### 1.2 Identity: a screen name first, a real name only if you choose

When a player joins, they pick a **screen name** (e.g.
"FloorballStar15") and, optionally, an avatar/emoji — that's the identity
shown everywhere in the app: leaderboards, badges, chat, the video feed.

A player's **real legal name is entirely optional to provide**, and if it
is provided, it is only ever visible to that specific player's own coach,
in a coach-only admin view — never shown to teammates, never shown on any
leaderboard, badge, or clip, and never returned by any of the ordinary
player-facing parts of the app. This is enforced at the software level
(the code that powers leaderboards, chat, and the feed cannot even reach
that field), not just a rule someone has to remember to follow.

### 1.3 Age bands and who has to approve an account

Every player has a **birth year** on file (just the year — never a full
birthdate, and never a location, see Section 8). What that means for
account approval:

- **Under 13:** a parent or legal guardian must approve the account by
  email before the player can start logging training sessions, using
  chat, or uploading video. The player can still pick a screen name and
  look around the app immediately — approval is required before the app
  starts building up any real activity history for that child, not
  before the account can exist at all.
- **13 and over:** the player can approve their own account by confirming
  their own email address, without a parent's involvement. This currently
  matches the self-consent age set by Swedish law for this kind of
  service (Dataskyddslagen 2018:218, implementing GDPR Article 8) — see
  the open question about other countries at the end of this document.

Until an account is approved, the player can see the app but cannot log
training, chat, or upload video — the app shows a plain waiting state
instead.

### 1.4 One parent/guardian contact, used only for the approval flow

If a parent or guardian's contact info (email or phone) is on file for a
player, it is used **only** to run this approval flow (and later, safety
notifications — see Section 6) — it is never shown to other players or
coaches, and is stored separately from everything else about the player
specifically so that an ordinary query for player/leaderboard/feed data
cannot accidentally return it.

---

## 2. What data this app collects, and why

| What | Why it's collected | What it is *not* used for |
|---|---|---|
| Screen name, avatar | The identity shown in the app | Never linked to a real name in anything player-facing |
| Real name (optional) | Only if a family chooses to give it, visible only to that player's own coach | Never shown to teammates, never on a leaderboard/feed/badge |
| Birth year | Deciding which approval flow applies (Section 1.3), and age-appropriate challenges (e.g. "for 11-year-olds") | Never a full birthdate |
| Parent/guardian contact | Running the approval flow, and safety-report notifications (Section 6) | Never shown to other players, never used for marketing |
| Training log entries (activity type, duration, timestamp) | Powers the streak, the team point pool, and challenge progress | **Never location** — the app records *that* a player trained and *when*, never *where* |
| Team chat messages | Lets teammates and captains talk to each other inside their own team | Never shown outside that one team |
| Video clips | The team's short-clip feed (players sharing training moments) | Never shown outside that one team; see Section 5 for how these are handled specifically |
| Language preference | Shows the app in the player's chosen language | Not a location signal — it is a language choice, not a country/device-location value |

**There is no location tracking anywhere in this app**, ever, for any
purpose. This is a deliberate, structural design decision — there is no
"where did you train" field, and no device-location permission the app
asks for.

---

## 3. Beta / early access status

This app is a **real, live beta**, not a finished commercial product.
That has some practical consequences worth stating plainly:

- Features may change, be added, or be removed as the app develops.
- Bugs happen. This project takes data handling seriously (see the
  sections above and below), but "beta" means things are actively being
  built and tested, not that everything has been fully hardened yet.
- There is no dedicated, round-the-clock support team behind this app —
  it is built and operated by a small team (currently effectively one
  person: a coach building this for their own and other youth teams).
  Response times to questions, requests, or reports should be expected to
  reflect that.

---

## 4. Parental rights

If you are a parent or guardian of a player using this app, you can:

- **Approve or decline** the account before it can log training, chat, or
  upload video (Section 1.3).
- **Ask to see or correct** what's on file for your child (contact
  details, screen name, birth year) — reach out via the contact method in
  Section 10; there isn't yet a dedicated self-service "view my data"
  screen for parents specifically (a player can already see and edit
  their own profile in-app).
- **Change the contact email/phone on file** — the app supports this as a
  self-service action from the player's own profile, with a confirmation
  step and a short window to catch a mistake or an unauthorized change
  before it takes effect.
- **Request that your child's account, and everything tied to it, be
  permanently deleted** — see Section 7 below for exactly how this works
  and what it actually does.

---

## 5. Video clips: how they're handled

The app has an internal, team-only short video clip feed. If your child's
account is approved to upload:

- Clips are only ever visible to that player's own verified team —
  structurally, the same closed-bubble rule as everything else in this
  app (Section 1.1). They are never public, never shared outside the app,
  and never sent to an outside video hosting company — clips are stored
  on this project's own infrastructure.
- **Before a clip is ever visible to anyone**, the app strips out
  location and device metadata that phones often embed in video files
  automatically (e.g. GPS coordinates), so a clip recorded at home cannot
  leak a home address even though the app itself never asks for or stores
  location.
- **Clips are automatically and permanently deleted after a limited
  time** — currently a rolling 90-day window from upload (this number is
  a product setting, not a fixed promise, and may be adjusted; check the
  in-app copy for the current figure).
- **A player can delete their own clip at any time**, immediately and
  permanently — this is also, in practice, the fastest way to get a
  specific video taken down if a parent asks for it.
- **If a clip is reported** (see Section 6), it is automatically hidden
  from the whole team right away, pending a human follow-up — it is not
  deleted outright unless the uploader deletes it themselves or it later
  ages out.

---

## 6. Reporting, blocking, and the honest limits of moderation

This is the part of this document we want to be most straightforward
about, because we think overpromising here would be worse than being
honest about what the app can and can't currently guarantee.

**What the app actually does today:**

- Team chat messages are checked against a word filter before they can be
  sent — a message using a disallowed word is rejected and never sent (it
  is never silently edited or censored-and-sent).
- Any player can **report** a chat message or a video clip they think is
  a problem. Reporting is anonymous to other players — the person who is
  reported is never told who reported them.
- Any player can **block** another player, silently, from their own
  point of view — blocking hides that person's messages from you and does
  not notify them.
- A report triggers a **best-effort email** to the reported player's own
  parent/guardian and, if one is on file, the team's coach.
- Reporting a video clip **automatically hides that clip** from the whole
  team immediately, pending human follow-up.
- Reporting a chat message does **not** automatically hide it (a
  deliberate difference from clips, made because giving any one child the
  power to instantly silence a teammate's message came with a bigger
  downside).

**What the app honestly does not guarantee, and you should know that
going in:**

- **There is no guaranteed review time, and no guaranteed human review at
  all**, for a report. The email notifications above are real and are
  sent — but whether a parent or coach reads that email promptly, or at
  all, is out of this app's control. There is currently no dedicated
  moderation team reviewing reports.
- **There is no in-app appeal process.** If a clip is auto-hidden by a
  report and that turns out to have been unfair, restoring it currently
  requires a manual, out-of-band action by whoever runs the app — there
  is no button for this yet.
- **The chat word filter catches specific words, not bullying or
  concerning behavior expressed in otherwise "clean" language.** It is a
  real but limited safety net, not a guarantee that harmful messages
  can't get through.
- **Blocking only changes what you personally see.** It does not remove
  the other person's ability to use the app, and it does not notify a
  parent or coach on its own.

**If something urgent or serious happens** — anything involving safety,
threats, or anything you'd call the police or a school about in real
life — **please do not rely on this app's report/block features as your
only response.** Talk to a coach, a parent, or, if appropriate, the
relevant authorities directly. This app's reporting tools are a real,
useful signal, not a substitute for that.

---

## 7. Account deletion (the right to be forgotten)

This app has a real, working self-service way for a player to delete
their own account and everything tied to it — this section describes
exactly how it works, not a generic "you can ask us to delete your data"
promise.

1. **A player starts the request in-app**, from their profile. This step
   by itself does nothing permanent yet.
2. **A confirmation email is sent** to the contact on file (the parent's,
   for an under-13 player; the player's own, for a self-verified 13+
   player). **Nothing durable happens until that email's link is
   confirmed** — a borrowed or momentarily-accessed phone tapping the
   in-app button by itself does not start the deletion clock.
3. **Once confirmed, a 30-day grace period begins.** During those 30
   days, the account works completely normally — nothing is locked,
   restricted, or hidden. A second email, with a cancel link, is sent at
   this point too.
4. **The request can be cancelled at any time during those 30 days**,
   either with one tap in the app or via the emailed link — cancelling
   fully restores things to normal, with no lasting effect.
5. **If the 30 days pass without being cancelled, deletion happens
   automatically and is permanent.** At that point:
   - The player's private info (real name if given, parent/guardian
     contact), consent history, training log history, badges, and video
     clips (including the video files themselves) are **permanently
     deleted**.
   - Team chat messages the player sent are **kept but anonymized** —
     the message content is replaced with a placeholder, so the rest of
     the team's conversation isn't left with confusing gaps, but the
     message is no longer attributed to that player.
   - A weekly team goal the player created as captain is **kept, with
     the "created by" attribution removed** — it's shared team history,
     not personal data.
   - The team's overall shared point total is **not reduced or
     recalculated** — points a player already contributed to the shared
     team pool are not "clawed back," since that pool is a merged,
     shared total, not a personal record.
   - If the player is their team's captain and has teammates, they choose
     who takes over as captain before deletion executes.
   - **If the deleted player was the last remaining player on their
     team**, the entire team (including its chat history and any
     remaining clips) is deleted along with them.
   - A safety report that had been filed *about* this player by a
     teammate is **kept** (with the player reference removed) — so a
     genuine safety concern that was raised about someone isn't erased
     just because that person later deleted their own account.

This is a real, already-designed mechanism (not a promise to build one
later) — see `docs/adr/0013-account-erasure.md` for the full technical
decision if you want more detail than this summary.

---

## 8. No payments, no purchases

**This app does not currently have any payment, subscription, or
in-app-purchase feature of any kind.** There is nothing to buy, no paid
tier, and no feature gated behind payment. This section exists only to
say that plainly, not to describe terms for a feature that doesn't exist
yet — if that ever changes, this document would need a real, specific
payments section at that time, written when there's an actual feature to
describe.

---

## 9. Language

This app is built to support multiple languages, and this document itself
may eventually need translated versions. **This particular draft exists
only in English.** If English is not a language you (or your child) can
confidently read, please treat this draft as provisional and ask for a
translated or explained version before relying on it — a consent or
agreement decision made in a language someone can't confidently read is a
real comprehension risk, not just a formality (see the open question
about this at the end of this document).

---

## 10. Changes to this document, and contact

Because this app is in active beta (Section 3), this document is expected
to change as features change. Material changes will be reflected here
directly; there is not yet a formal "we will notify you N days before a
change" process defined — that's one more thing a real legal review
should decide, not something this draft invents.

**Contact:** [to be filled in by the project owner — there is currently
no dedicated legal/privacy contact email defined for this project; do not
invent one here].

---

## Open legal questions — not resolved here, flagged for the project owner and a real lawyer

This draft deliberately does **not** guess at the following. They are
real gaps, not oversights:

1. **Governing law / jurisdiction.** This document does not state which
   country's law governs it, or where a dispute would be handled. That
   depends on where the app's operating entity is legally established,
   which isn't something a UX designer should decide.
2. **Age of consent outside Sweden.** Section 1.3's "13 and over can
   self-approve" rule matches Sweden's actual legal minimum today (the
   only jurisdiction this has been checked against, per
   `docs/adr/0002-data-model.md`'s addendum). The app now supports 8
   languages/locales spanning multiple countries (Sweden, Finland,
   Denmark, Norway, Germany/Austria/Switzerland, Czech Republic, plus
   English and French more broadly) — and the actual GDPR Article 8
   self-consent age is **not the same 13 everywhere**: it ranges roughly
   13-16 depending on the EU/EEA member state, and Switzerland isn't
   under GDPR at all (it has its own Federal Act on Data Protection).
   This document, and the app's actual behavior, currently only implement
   Sweden's rule — this is a real, unresolved gap for any family using
   this app from outside Sweden, not just a documentation nuance.
3. **Which entity is actually "offering" this service.** This draft talks
   about "this app" throughout rather than naming a specific company,
   because no legal entity has been specified for this project in
   anything this draft was written against. A real Terms of Service needs
   a named responsible party.
4. **A formal complaints/DPA-authority contact.** GDPR-facing documents
   like this typically name a specific supervisory authority a user can
   escalate to (e.g. Sweden's IMY) — not included here since it depends
   on the jurisdiction question above.
5. **Data retention for entities not covered by ADR-0013's erasure
   flow** — e.g. exactly how long an *unapproved* (never-consented)
   account's minimal onboarding data is kept if a parent never responds
   at all. Not designed anywhere in this codebase yet.
