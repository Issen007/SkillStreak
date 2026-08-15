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
> Every factual claim below was checked against the code on 2026-08-15
> and cites where it lives, so a reviewer can verify rather than trust.

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
| Badges, streaks, points | The game itself | `badge_award`, `team_pool` |

**We do not collect location.** Not from the device, not from a photo, not
from a video. The app records *that* a child trained, never *where*. Video
frames sampled for automatic tagging are stripped of all metadata
(`-map_metadata -1` in `clip-frame-sampler.service.ts`) precisely so a
file cannot carry a location out of the app.

**We do not use third-party analytics, advertising or tracking SDKs.**
There are none in the app's dependencies — this is checkable, not a
promise.

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
- Tags are internal. They are not shown to players, do not affect points
  or badges, and are not used to rank anyone.

## 7. How long we keep things

| Data | Kept for |
|---|---|
| Video clips | 90 days |
| Bug reports | 90 days |
| Error logs | 90 days |
| Generated training plans (staff) | 365 days |
| Event registrations | 365 days |
| Account data | Until the account is deleted |

## 8. Deleting an account

A player can delete their own account from the app (Profile → delete
account). Deletion removes their personal data, including clips, chat
messages and training history, subject to the successor rules that apply
if they are a team captain.

## 9. Staff data

Staff sign in with Google, Microsoft or Apple. We store the email address
and display name their provider returns, and a record of which teams
invited them. We never receive or store their password.

## 10. Your rights

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
   consent-based). Each purpose needs its basis named.
3. **Age of digital consent.** It is 13 in Sweden but varies from 13 to 16
   across the EU. The app's 13+ self-verification is correct for Sweden
   and may not be for a Finnish or German user — and the app already ships
   in eight languages.
4. **Automatic tagging under Article 22.** It produces no decision with
   legal or similarly significant effect today, so Article 22 likely does
   not apply — but that conclusion should be confirmed rather than
   assumed, and it changes if tags ever drive badges or ranking.
5. **The cross-team clip feed that has been discussed but not built.**
   Existing parental consent covers team-only visibility. Publishing a
   child's clip beyond their team would need fresh consent, and this
   document must be updated *before* that ships, not after.
6. **Processors.** Hosting, object storage and email delivery are
   third-party services and need naming, with data processing agreements
   in place.
7. **Transfers outside the EU/EEA**, if any processor implies them.
