# ADR-0037 — Letting a player say what would make the app better

## Status

Accepted, 2026-09-09. Requested by the project owner ahead of the public
launch: *"under our Tips/Ideas it should be a short information text and a
button to submit improvement of the app… so we can look at the idea and
analyze the idea so we get our app much better."*

Shipped the same day. Two of the calls below were the project owner's own,
taken on the questions this ADR could not answer for them — see
Decisions 4 and 5.

## Context

The Tips tab is the one place in this app that talks to a player without
asking anything of them: an operator-reviewed feed of coaching tips,
written by adults, read by children, with no comments, no reactions and
no reply channel. That was deliberate (see `TipsScreen`'s own docstring).

What it also means is that a child who thinks the app should do something
differently has nowhere to say so. The nearest thing that exists is the
Phase 7 bug-report flow (ADR-0022 Decision 7), which is buried on the
Profile screen and is explicitly about things that are *broken*. "It
would be better if the team meter showed last week too" is not a bug, and
filing it as one produces a triage queue where the operator cannot tell
the two apart.

## Decision

### 1. A sibling table, not a `kind` column on `bug_report`

The two features share a shape — voluntary player free text, one
operator's triage queue, a 90-day sweep, an erasure cascade — and that
made folding suggestions into `bug_report` behind a discriminator
tempting.

Rejected, because `bug_report.category` and `bug_report.screen` are NOT
NULL Postgres enums *specifically* as a result of the 2026-08-02
security-reviewer correction, which found the original draft describing
`screen` in prose as a fixed allow-list while typing it as an
unconstrained varchar. Folding suggestions in means making both nullable
— loosening a constraint that was argued for, in order to save a table.

`improvement_suggestion` therefore stands alone, and captures **less**
than its sibling: the body, the app version, the locale, the timestamp,
and the author's id. No platform, no OS version — an idea is not a device
fault, and nothing about triaging one needs them.

What *is* shared is shared for real, rather than copied: the console's
three-state triage vocabulary, the reporter-identity lookup
(`admin-reporter-index.util.ts`, extracted from
`AdminBugReportsService` in this change), and the recipient resolution
for internal report mail (`common/mail/report-recipient.util.ts`,
extracted from `UsageMetricsReportService`). Each of those encodes a
decision that must not be allowed to drift between two copies.

### 2. One required free-text field, and nothing else

No category picker, no title, no "which screen" chips. A bug report needs
its pickers because a category alone is still a useful report; a
suggestion is only ever the sentence the child wrote, and every extra
required field is a reason not to bother. The body is required (unlike a
bug report's optional description) because there is no picker here to
fall back on: a suggestion with no words is nothing.

The 500-character cap is the column's own width, applied as a *cap on the
input* rather than a validation that rejects afterwards — a child who
types past a limit and then loses the text will not type it again.

### 3. Retention: 90 days, by age alone

Same bound and same reasoning as `bug_report` and `error_log_entry`, and
it ships with the table rather than being added later after a review
notices (which is what happened to `bug_report`, on 2026-08-09).

The temptation to exempt this table is stronger than it was for bug
reports, because a good idea feels like something to keep. It is — **in
the backlog, in the operator's own words.** A row here is a child's free
text; letting it sit for a year is not keeping the idea, it is only
failing to delete the child's data. That is also why the console's status
PATCH takes no admin-notes field: somewhere to think about an idea is a
real need, and a table of child-authored text is not it.

### 4. No consent gate — the project owner's call, 2026-09-09

A player whose parental consent is still `pending` may send a suggestion,
matching `BugReportsService`'s deliberate `JwtAuthGuard`-only posture.

The argument: what parental consent protects is a child writing into a
team's shared space. A suggestion goes to the operator and to no peer,
ever. Applying a different rule to the app's two free-text-to-operator
surfaces would leave a distinction nobody remembers the reason for in six
months.

This is a narrow, argued exception and not a general loosening. The
consent-gated surfaces (training logs, team chat, clips) all write into a
team's shared space and stay gated.

### 5. Delivery: the console queue, plus a counts-only weekly digest —
the project owner's call, 2026-09-09

The options put to the owner were console-only, console plus a full
notification mail per suggestion, and console plus a weekly digest of
counts. They chose the third.

The middle option was the one worth refusing, and the digest's template
enforces the refusal: **no child-authored text is ever mailed.** Text
copied into a mailbox is outside this app's retention sweep, outside its
erasure cascade, and outside every other control it has over that data.
`ImprovementSuggestionDigestCounts` has no field a body could occupy, and
`ImprovementSuggestionDigestService` only ever issues `count` queries —
the text is never in that service's hands to leak.

The digest goes out Monday 08:00 to `USAGE_REPORT_RECIPIENT_EMAIL`,
reusing the existing key rather than adding a second address knob. This
project has been broken three separate times by a Secret key that existed
in GitHub Actions and not in the cluster; a new key would be a fourth
chance at exactly that, in exchange for the ability to send two internal
reports to two different mailboxes, which nobody has asked for.

It sends nothing at all in a week with no arrivals *and* an empty
backlog. A weekly "0, 0" is how a digest teaches its one reader to filter
it away — the same lesson permanently-red `expo-doctor` already taught
this project. A backlog with no arrivals still sends: that one is the
queue asking to be looked at.

### 6. Where it lives in the app

A card at the **bottom** of the Tips tab, below the feed's visible end
marker: short information text, then one secondary button that opens the
form. The tab is for reading tips; this is what you do once you have run
out of them. It is reachable precisely because that list ends — which is
one more reason never to make the feed infinite.

The form carries the same disclosure block the bug-report form does,
stating what leaves the phone (the text, the language, the app version)
and what does not (where you are, which phone, your real name), and who
reads it (the people who make the app; nobody on your team). Neither the
form nor the success screen promises a reply, because the design has no
reply channel — the operator moves a status and nothing writes back.

## Consequences

- The Tips tab now carries the one thing a child may write in it. Nothing
  on that screen renders player-authored text, and nothing a child writes
  there reaches another child. CLAUDE.md's closed-team-bubble constraint
  is untouched: this is not a peer-visible surface, and no clip, chat
  message, training log or real name moves anywhere.
- The admin console gains an "Ideas" section, with the same untrusted-text
  handling as the bug queue: the body and both identity fields are
  escaped everywhere they are rendered, `title=` attributes included.

  **Checked in a browser on 2026-09-09**, against a local API and seeded
  rows, because "it is escaped" is the kind of claim that reads as true
  in a diff and is false on a page. A suggestion whose body was
  `<script>alert("xss")</script> och en <b>mörkt läge</b> tack`, written
  by a player whose screen name was set to
  `<img src=x onerror="alert(1)">Ras` — a realistic carrier, since screen
  names still have no charset validation anywhere in `backend/src` —
  printed as literal text in both fields: no markup applied, no image
  request, no dialog, nothing in the console. The status PATCH, the
  filter chips and their table-wide counts were exercised in the same
  pass.
- `GET /api/v1/admin/improvement-suggestions` deliberately carries **no
  player id**, no filter by author, and no search. ADR-0022 Decision 5's
  named anti-pattern is a per-child view arriving through a table like
  this one.
- Two extractions touched existing code (the reporter index and the report
  recipient). Both were behaviour-preserving; the existing specs for
  `AdminBugReportsService` and `UsageMetricsReportService` cover them and
  pass unchanged.

## Open questions

None blocking. One worth revisiting once real suggestions arrive: whether
the operator wants a way to mark an idea as "built" distinctly from
"closed". Deliberately not guessed at now — three states is what the
console already draws, and a fourth invented before anyone has triaged a
real queue would be sizing a control against a guess.
