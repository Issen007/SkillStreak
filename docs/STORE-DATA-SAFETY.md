# Store data-safety answers, drafted from the schema

For Apple's **App Privacy** questionnaire and Google Play's **Data Safety**
form. Companion to [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md) §1.3, which
lists these as blocking.

Drafted 2026-08-22 by walking all 37 entities and the mobile dependency
list, not from memory. That distinction matters: the privacy policy was
written the same way and had still drifted from the code by the time the
2026-08-22 security review caught it. Every claim below names where it
comes from, so it can be re-checked rather than re-trusted.

**Scope: the app only.** The marketing site's own data — the signup list
(`event_registration`) and the aggregate counters (`link_click`,
`site_visit`) — is not app data and does not belong on these forms. It is
covered by the privacy policy's §8.

---

## The three answers that matter most

### Data used to track you: **None**

Apple's definition of tracking is linking data to third-party data for
advertising or sharing with a data broker. None of it happens, and the
codebase can prove it:

- **No advertising identifier, no device identifier of any kind.** Nothing
  reads IDFA, an Android ad id, an installation id or a device id — grep
  the app for any of them and there is nothing to find.
- **No third-party analytics or ad SDK.** The entire dependency list is
  Expo and React Native core, two Google Fonts packages, i18next, SVG and
  QR rendering. Nothing else.
- **`expo-network` is present and does not collect anything.** It is read
  once, locally, to ask whether the connection is cellular before deciding
  to pre-upload a clip. The IP address is never read and never sent.

### Data linked to the user: **most of it**

Almost everything is tied to a player account, because the product is a
team roster. Answer "linked" rather than hunting for exceptions.

### Third-party sharing: **None**

Nothing is sold, and nothing is shared for advertising. The hosting
provider, the object store and the SMTP relay are processors acting on
instruction, which both stores treat as service providers rather than
sharing — but declare them in the policy, not by ticking "shared".

---

## Data types collected

Each row names the column or file it comes from.

| Category (Apple / Play) | Collected | Where it lives | Purpose | Linked | Tracking |
|---|---|---|---|---|---|
| **Contact Info — Name** | Optional | `player_private_info.real_name`, AES-256-GCM encrypted | Only so a coach can identify a player; a screen name is the default and a real name is never shown to other players | Yes | No |
| **Contact Info — Email** | Yes | `player_private_info.parent_contact` (encrypted) — the **parent's**, not the child's; `staff_account.email` for adults | Parental consent, erasure confirmation, sharing consent | Yes | No |
| **Health & Fitness — Fitness** | Yes | `training_log_entry.activity_type`, `.duration_minutes`, `.logged_at` | The streak and the team's point pool — the core of the app | Yes | No |
| **User Content — Photos or Videos** | Yes | `video_clip` + object storage | Team-only clip feed; opt-in public feed under parental consent | Yes | No |
| **User Content — Other** | Yes | `team_chat_message.content`, `video_clip.caption` | Team chat and clip captions | Yes | No |
| **User Content — Customer Support** | Yes | `bug_report.description` | Bug reports the player writes | Yes | No |
| **Identifiers — User ID** | Yes | `player.id`, internal only | Account identity | Yes | No |
| **Diagnostics — Other** | Yes | `bug_report.app_version/.platform/.os_version/.screen/.locale`; `error_log_entry` | Diagnosing a reported problem | Yes | No |
| **Other Data — Age band** | Yes | `player.birth_year` (year only, never a full date) | Age-banding the consent flow: who must have a parent approve | Yes | No |

### Explicitly **not** collected

Each is a deliberate design decision with a comment in the code, not an
omission:

- **Precise or coarse location — never, anywhere.** No `expo-location`, no
  geolocation call, and `bug_report`'s own entity comment names it: *"never
  device geolocation … never a device identifier/advertising id, never an
  IP address"*.
- **No IP address stored**, in the app or the site's counters.
- **No contacts, no calendar, no microphone or camera beyond an explicit
  clip recording, no browsing history, no purchases** (there are none), **no
  financial info**, **no crash SDK**.
- **EXIF and GPS are stripped from every uploaded clip** by a mandatory
  remux before it is stored (ADR-0010).

---

## Answers to the specific form questions

**Is all data encrypted in transit?** Yes — TLS everywhere, HSTS on both
hosts.

**Can users request deletion?** Yes, and it is in-app: Profile → delete
account, self-service, with a mailed confirm and cancel. Both stores now
require this for apps with accounts, and it already exists.

**Is any data collected from children?** Yes — this is a child-directed
app for 9–13-year-olds. Answer it plainly; declaring otherwise is both
untrue and more dangerous than the rules it would dodge.

**Retention.** Clips 90 days, bug reports 90, error logs 90, and account
data until the account is deleted. Each is a constant in the code enforced
by a scheduled sweep, not an intention.

---

## Two answers to give deliberately

**Fitness data is easy to miss.** A training log is a record of physical
activity, which puts this app in Apple's Health & Fitness and Play's
Health and fitness categories. It would be simple to think of it as
"app activity" and under-declare — that is the kind of mismatch a reviewer
notices.

**`birth_year` is a year, not a birthday.** Play's form has no exact slot
for it; "Other info" under Personal info, with a note that only the year is
stored, describes it honestly. Saying "date of birth" would over-declare
something the schema deliberately does not hold.

---

## Re-check before submitting

This was true on 2026-08-22. Anything that adds an SDK, a push token, an
analytics call or a new column changes an answer here — most of all
anything that would turn "Data used to track you: None" into something
else, which is the single most valuable answer on the form.
