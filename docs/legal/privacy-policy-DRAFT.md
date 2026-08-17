# SkillStreak — Integritetspolicy / Privacy Policy (WORKING DRAFT)

> ## ⚠️ THIS IS A NON-LEGAL WORKING DRAFT — NOT REVIEWED BY A LAWYER
>
> Written by an AI coding agent with the project owner, grounded in what
> the app actually does today, so a real lawyer has something concrete to
> react to instead of a blank page. It is **not**:
>
> - A finished, legally binding privacy policy.
> - Reviewed, drafted, or approved by a lawyer.
> - Suitable for a real public launch as-is.
> - Legal advice, for the project owner or for anyone else.
>
> Same posture as `terms-of-service-DRAFT.md` and
> `code-of-conduct-DRAFT.md`.
>
> **This one carries more weight than those two**, for two reasons worth
> stating plainly:
>
> 1. **Both app stores require a publicly reachable privacy policy URL
>    before submission.** Nothing ships without one, so this draft is on
>    the critical path in a way the others are not.
> 2. **This app processes children's personal data in the EU.** That is
>    the highest-sensitivity category the GDPR recognises, and getting
>    this document wrong is not a paperwork problem. A lawyer with data
>    protection experience should read it before it is published, and the
>    open questions at the end are the ones to put in front of them
>    first.
>
> Every factual claim below was re-checked against the code on
> **2026-08-17** and cites where it lives, so a reviewer can verify
> rather than trust.
>
> **What that re-check changed**, so the diff is not mistaken for
> cosmetics: the data table was missing four categories the schema
> actually holds (consent records, safety reports and blocks,
> streak-saver events, erasure requests); it cited a `team_pool` table
> that does not exist, now corrected to `team_season_pot`; the trainer
> tips feed and the public website's click counters were not described
> at all; and the processors section has gone from "needs naming" to
> naming the three that are self-hosted and isolating the two that
> genuinely still need an answer.

---

## 1. Who we are

SkillStreak is an app for youth floorball players, built by their coach.
The controller of the personal data described here is the project owner.

**To be completed before publication:** legal entity name, postal address,
and a contact email address for data protection questions. A privacy
policy with no reachable controller is not compliant, and this is the one
gap the code cannot fill in.

## 2. Who uses the app, and what that means here

Two very different groups:

- **Players** — children, typically 9–13. Most of this document is about
  them.
- **Staff** — coaches, trainers and the operator. Adults, signing in with
  Google, Microsoft or Apple.

The strictest rules follow the children, so they are described first.

## 3. What we collect about a player, and why

| Data | Why | Where it lives |
|---|---|---|
| Screen name | So teammates can recognise each other | `player` |
| Real name (optional) | Only so a coach can match a screen name to a child | `player_private_info`, **encrypted at rest** |
| Birth year | Age banding and the consent route (13+ may self-verify) | `player` |
| Parent/guardian contact | To ask for consent, and nothing else | `player_private_info`, encrypted |
| Training log entries | The streak and the team's shared point pool | `training_log_entry` |
| Video clips | The team-only clip feed | Object storage; metadata in `video_clip` |
| Chat messages | Team chat | `team_chat_message` |
| Badges, streaks, points | The game itself | `badge_award`, `team_season_pot` |
| Consent records | Proof that a parent approved, and when | `parental_consent_record` |
| Safety records | Reports of a clip or a chat message, and who a child has blocked | `clip_report`, `team_chat_message_report`, `team_chat_block` |
| Streak-saver events | The "you didn't lose your streak" mechanic | `streak_saver_event` |
| Erasure requests | Carrying out an account deletion, and proving it happened | `account_erasure_request` |

**We do not collect location.** Not from the device, not from a photo, not
from a video. The app records *that* a child trained, never *where*. Video
frames sampled for automatic tagging are stripped of all metadata
(`-map_metadata -1` in `clip-frame-sampler.service.ts`) precisely so a
file cannot carry a location out of the app.

**We do not use third-party analytics, advertising or tracking SDKs.**
There are none in the app's dependencies — this is checkable, not a
promise.

**A note on the safety records**, because they are the row a reader is
most likely to be surprised by: reporting a clip or a chat message, and
blocking another player, necessarily record who did it. That is
unavoidable — a report nobody can act on is not a safety feature — but it
means a child's use of the safety tools is itself stored data, and a
lawyer should be asked whether it needs saying more prominently than a
table row.

## 4. Consent

- **Under 13:** a parent or guardian must approve the account before it is
  created, via an emailed consent link. Media upload requires that
  approval.
- **13 and over:** the app supports age-banded self-verification.
- **Trainer access:** a trainer outside the team can only see a child's
  data after a separate, explicit parental approval, which names that
  trainer. Either the family or the team can revoke it at any time, and
  revoking is immediate.

## 5. What a child's data is NOT used for

- Not sold, and not shared with advertisers.
- Not used to train any AI model. Automatic clip tagging uses a
  pre-trained model that **retains nothing** — frames are scored and
  discarded, and the analysis service has no storage.
- Not visible outside the child's own team. Clips, chat and training logs
  stay inside the team ("closed team bubbles").

## 6. Automatic clip tagging

Published clips may be analysed automatically to label the *type of
training* shown — passing, shooting, fitness and similar, from a fixed
list of eight.

Stated honestly:

- It labels **activity, not people**. It is not face recognition, not age
  estimation, and not any kind of safety or content classifier.
- What is analysed is a small number of still frames, reduced to 224×224,
  silent, and stripped of metadata. This reduces what leaves our main
  system; it is **not** anonymisation, and a close-up frame can still show
  a recognisable face.
- Tags are internal (`video_clip_tag`). They are not shown to players, do
  not affect points or badges, and are not used to rank anyone.
- The analysis runs on **our own hardware** — a self-hosted GPU cluster
  described in section 12 — not on any third-party AI service. No frame
  of a child is sent to an external model provider.

## 7. Tips from trainers

The app has a reading feed of short coaching tips (`trainer_post`).

- Every post is **written by an adult** — a coach, trainer or the
  operator — and **read by the operator before** it can appear.
- It contains **no child's data**. Nothing a player does, writes or
  uploads reaches it.
- **Children cannot reply.** There is no comment, reaction or message
  route in the feature, so no child's words go anywhere through it, and
  no author can be contacted through it.
- Authors may not publish contact details. Email addresses, phone numbers
  and web addresses are rejected, so the feed cannot be used to move a
  child into a private conversation elsewhere.

It is described here because it is content an adult outside the child's
team publishes *to* children, which is a thing worth disclosing even
though it collects nothing.

## 8. The public website

`skillstreak.xyz` counts how often a few links are clicked — "get the
app", "try it", and similar (`link_click`).

This is **an aggregate counter, not analytics**. One row per link per
day, incremented in place. There is deliberately no cookie, no IP
address, no session, no user agent, no referrer and no time of day, so
the table cannot answer "who clicked" — not because the data is
protected, but because it was never collected.

## 9. How long we keep things

| Data | Kept for |
|---|---|
| Video clips | 90 days |
| Bug reports | 90 days |
| Error logs | 90 days |
| Generated training plans (staff) | 365 days |
| Event registrations | 365 days |
| Account data | Until the account is deleted |

Each figure is a constant in the code (`DEFAULT_CLIP_RETENTION_DAYS` and
its siblings), enforced by scheduled sweeps rather than by intention.

## 10. Deleting an account

A player can delete their own account from the app (Profile → delete
account). Deletion removes their personal data, including clips, chat
messages and training history, subject to the successor rules that apply
if they are a team captain.

## 11. Staff data

Staff sign in with Google, Microsoft or Apple. We store the email address
and display name their provider returns, and a record of which teams
invited them (`staff_account`, `team_coach`). We never receive or store
their password.

## 12. Who processes this data

Unusually for an app of this kind, the whole software stack is
self-hosted — no managed database, no third-party object storage, no
external AI service. The hardware underneath it is rented, so the
hosting provider sits beneath the first three rows even though no
service of theirs appears in them:

| What | Who | Third party? |
|---|---|---|
| Application and database | Our own Kubernetes cluster | Software: none. Hardware: **Safespring** |
| Video and image storage | MinIO, running in that same cluster | Same |
| Automatic clip tagging and training-plan generation | Our own GPU cluster | Same |
| Email (consent links, approvals) | **Google** — `smtp.gmail.com:587`, sending as `noreply@isstech.io` | Yes |
| Staff sign-in | Google, Microsoft, Apple | Yes |

**The email arrangement is explicitly interim** (owner's decision,
2026-08-17): mail goes out through Google's SMTP from an `isstech.io`
address, which is a domain belonging to the owner's other work rather
than to SkillStreak. A dedicated `skillstreak.xyz` mail domain and its
own account are planned. Recorded here rather than left implicit because
consent emails are the mechanism the entire parental-approval model
rests on, so who carries them is not an incidental detail.

**To be completed before publication**, and these are genuinely open
rather than rhetorical:

1. **Safespring** — named by the owner, 2026-08-17. Rented hardware:
   Safespring owns the machines, the owner owns the data and runs
   everything on top.

   A **Swedish** provider, which is the single most helpful fact in this
   whole section: it means the largest concentration of children's data
   here — the database, every video clip, every chat message — is very
   likely to stay inside the EU/EEA, and the third-country transfer
   problem that dominates most GDPR reviews does not arise for it. Worth
   confirming in writing rather than assuming, since the answer should
   be easy to obtain and is load-bearing: **which region or datacentre
   the resources actually run in**, and whether any support or backup
   path reaches outside the EEA.

   **Still required: a data processing agreement.** A caution for the
   lawyer's attention, because the reasoning that made this look settled
   does not carry the weight it appears to: owning the data is what
   makes the owner the *controller*, and that is the source of the
   obligations in this document rather than an exemption from them. A
   provider whose disks hold children's personal data is normally a
   *processor* however the ownership is described, and a DPA is what
   governs that relationship. Dedicated hardware narrows what the
   provider can reach and encryption at rest narrows it further — both
   worth raising — but neither replaces the agreement. A provider of
   Safespring's kind will have a standard DPA available; it needs
   signing and filing, not negotiating.

2. **Whether the Google mail account is Workspace or consumer Gmail.**
   This decides whether a data processing agreement is even available:
   Google offers one for Workspace, while consumer Gmail runs on
   consumer terms that do not include one. Since these are the emails
   carrying parental consent requests, an arrangement with no available
   DPA would be a real gap rather than a formality. The planned move to
   a dedicated `skillstreak.xyz` mail account is the natural moment to
   settle it.

3. **Data processing agreements** with the hosting provider and with
   Google, plus confirmation of whether either implies a transfer
   outside the EU/EEA. Google's corporate parent is in the US, so this
   needs a real answer rather than an assumption.

## 13. Your rights

Under the GDPR you may request access, correction, deletion, restriction,
portability, and may object to processing. For a child, a parent or
guardian may exercise these rights. You may also complain to your national
data protection authority — in Sweden, Integritetsskyddsmyndigheten (IMY).

**To be completed before publication:** the address these requests go to.

---

## Open legal questions — not resolved here

Put these in front of a lawyer first:

1. **The controller's legal identity.** A private individual running a
   service that processes children's data across several clubs may need a
   different structure. This affects the whole document.
2. **Legal basis for each purpose.** This draft describes consent, but
   consent is not automatically the right basis for everything (service
   delivery, security logging, and abuse prevention often are not
   consent-based). Each purpose needs its basis named. The safety records
   in section 3 are the clearest example: a report or a block cannot
   sensibly rest on the reporting child's consent.
3. **Age of digital consent.** It is 13 in Sweden but varies from 13 to 16
   across the EU. The app's 13+ self-verification is correct for Sweden
   and may not be for a Finnish or German user — and the app already ships
   in eight languages.
4. **Automatic tagging under Article 22.** It produces no decision with
   legal or similarly significant effect today, so Article 22 likely does
   not apply — but that conclusion should be confirmed rather than
   assumed, and it changes if tags ever drive badges or ranking.
5. **The cross-team clip feed, now designed but still not built.**
   Existing parental consent covers team-only visibility. Publishing a
   child's clip beyond their team would need fresh consent, and this
   document must be updated *before* that ships, not after. The design
   is ADR-0019 as amended by ADR-0030, whose whole mechanism is a
   separate, revocable, default-off parental consent obtained precisely
   so that no existing family's team-only promise is reinterpreted. That
   design is the thing to put in front of the lawyer alongside this
   document — not after it ships.
6. **Processors — now named, agreements outstanding.** See section 12.
   All of them are identified: Safespring for hardware, Google for mail,
   and Google/Microsoft/Apple for staff sign-in. What remains is
   paperwork rather than discovery — a DPA with Safespring, and the
   Workspace-versus-consumer-Gmail question that decides whether a DPA
   with Google is even available.
7. **Transfers outside the EU/EEA.** Much smaller than it first looked.
   Safespring being Swedish means the bulk of the data — database,
   clips, chat — very likely never leaves the EEA, subject to confirming
   the region. What remains is Google: a US parent carrying the consent
   emails, and the staff sign-in identity providers. Those are the
   transfer questions worth the lawyer's time; the hosting one probably
   is not.
