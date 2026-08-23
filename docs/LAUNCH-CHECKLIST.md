# What is still needed to release the app

Companion to [`RELEASING.md`](RELEASING.md), which explains *how* to
publish. This is the list of what is not done yet, in the order it blocks
you, written 2026-08-22 and checked against what is actually deployed
rather than against what the docs claim.

`docs/internal/BACKLOG.md` has carried a placeholder for this since
2026-07-30 ("building an actual prioritized checklist … is still to be
done"). This is that checklist. It lives in `docs/` rather than
`docs/internal/` so it survives a clone.

**The separation that matters**, and the recommendation the backlog made
and nobody acted on: *demo-ready* and *launch-ready* are different bars.
The product itself can be demonstrated today, on the real cluster, to
anyone. Everything below is about putting it in a public app store.

---

## 1. Blocking — a submission fails or should not be made without these

### 1.1 The legal documents are drafts, and say so on the live page

`https://skillstreak.xyz/privacy` is reachable and returns 200. It also
tells the reader, in its own words, that it is **not** a finished, legally
binding privacy policy, **not** reviewed or approved by a lawyer, and
**not** suitable for a real public launch.

That is the single hardest blocker. A child-directed app is reviewed
against its privacy policy; a policy that disclaims being one cannot pass,
and submitting it anyway invites the slowest and most visible category of
rejection.

`terms-of-service-DRAFT.md` and `code-of-conduct-DRAFT.md` are in the same
state, and neither is published at all — `https://skillstreak.xyz/terms`
returns 404.

**Needs a lawyer.** The substance is written and accurate — the policy
describes the real schema, and the security review on 2026-08-22 corrected
the one place it was wrong. What it needs is review and sign-off, and that
is not something to fake.

### 1.2 ~~Nothing links to the privacy policy~~ — done 2026-08-22

Neither the app nor the site linked to it; the page existed only for
someone who already knew the URL. Now:

- **the site** links it from the footer, and from the signup form's own
  consent line — the sentence promising how a name and an email are used
  now points at the document that explains it;
- **the app** links it from the profile screen, beside "report a problem".

**One consequence, feeding §2.1.** The app's link is external. If
SkillStreak enters Apple's Kids Category, anything leaving the app needs a
parental gate; if it ships as a general listing with an age rating, the
link is fine as it stands. The link is deliberately *not* pre-gated — a
gate built against a decision nobody has made yet is as likely to be wrong
as right. Whichever way §2.1 goes, revisit this line.

### 1.3 The store declarations — **drafted 2026-08-22, still to be entered**

Neither Apple's App Privacy nor Play's Data Safety form has been submitted.
The answers now exist in [`STORE-DATA-SAFETY.md`](STORE-DATA-SAFETY.md),
walked from all 37 entities and the dependency list rather than from
memory — the same care the privacy policy was written with, which had
still drifted by the time the security review caught it, so every claim
there names the column or file it comes from.

Two things that came out of doing it: **training logs are fitness data**,
which puts the app in a Health & Fitness category it would be easy to
under-declare, and **"Data used to track you" is genuinely None** — no
advertising id, no device id, no analytics or ad SDK anywhere in the
dependency list. That last answer is the most valuable one on either form
and the easiest to lose by adding one library.

The honest answers are unusually good and worth using deliberately: no
location ever, no ads, no in-app purchases, no third-party analytics or
tracker SDK, parental consent gating media, screen names by default,
EXIF/GPS stripped on upload, retention windows enforced by scheduled
sweeps, and self-service erasure that works.

### 1.4 Build capacity — **iOS is out until 1 September**

Confirmed by EAS refusing a build, 2026-08-23:

> This account has used its iOS builds from the Free plan this month,
> which will reset in 8 days (on Tue Sep 01 2026).

Android still has quota; iOS has none. That is not a nuisance, it decides
the schedule, because **iOS build 17 is now the last iOS build available
this month and it does not contain the video-evidence fix** (`dd53c84`) —
choosing "Med video" when logging a session shows no picker and records
nothing at all.

So there are three options and they should be chosen deliberately:

1. **Pay for an EAS plan.** The only route to an iOS build before
   1 September, and therefore the only route to submitting an iOS build
   that is not knowingly broken.
2. **Submit build 17 anyway.** Not advisable: the evidence flow is a
   headline feature and its failure mode is silent — a child logs a session
   and nothing is recorded.
3. **Wait for 1 September**, build 18, then submit. Apple review then runs
   on top of that.

Option 3 puts an iOS release into the week of 1 September at the earliest.
Combined with §1.6, that means **neither store ships in the week of
24 August** unless the plan is upgraded.

### 1.5 Android build state — updated 2026-08-23

~~Latest Android build is build 2, from 2026-08-17. iOS is on build 14.~~
Both platforms have been rebuilt since. Current state:

    ANDROID  build 8  (dd53c84, 2026-08-23)  — in sync
    IOS      build 17 (31e6c27, 2026-08-23)  — behind, and cannot be rebuilt
                                               until 1 Sep (see §1.4)

**Both platforms carry the client crash reporter.** Only Android carries
the video-evidence fix, and iOS cannot until the build quota resets.

### 1.6 The Play closed-test clock is the real calendar risk

Separate from every code item on this list, and the only one that cannot
be compressed by working harder.

`docs/RELEASING.md` §3: Google requires newer **personal** developer
accounts to run a closed test with **~12 testers over 14 continuous days**
before production access is granted at all. `secrets/play-service-account
.json` does not exist in this working tree, so no build has ever been
submitted to a Play track from here — which suggests that clock has not
started.

**If it has not, Google Play cannot ship next week**, whatever state the
code reaches. That is not a reason to slow anything down; it is a reason
to start the closed test now and let the 14 days run underneath the rest
of the work. Apple has no equivalent waiting period, so a staggered launch
— iOS first, Play when the clock expires — may simply be what happens, and
it is much better to choose that than to discover it.

---

## 2. Decisions only the project owner can make

### 2.1 ~~Apple's Kids Category, or a general app~~ — DECIDED 2026-08-22: **Kids Category**

Owner's decision, written up as
[ADR-0034](adr/0034-kids-category-and-the-parental-gate.md). The one thing
it required in code is built: a parental gate in front of **all five** ways
out of the app, including the two OS share sheets — the friend invite and
the captain's PT-link code — which are easy to miss because App Review 1.3
reads like it is only about hyperlinks.

The gate is a compliance control, not a security one, and says so in its
own source: the users are 9–13 and can do arithmetic. It makes leaving the
app deliberate rather than accidental.

The original framing is kept below, because the reasoning is what makes
the decision re-checkable.

#### The choice as it stood

Two different regimes, and the choice is deliberate. Kids Category is
stricter — no behavioural advertising, a parental gate on anything leaving
the app, no external links without one — and it signals exactly what this
app is. A general listing with an age rating is easier and says less.

This decision changed the answers to several store questions, so it came
before filling the forms in — and it decided one piece of code: every exit
from the app now sits behind a parental gate (§1.2, ADR-0034).

### 2.2 Whether public sharing is on at launch

ADR-0030's public feed is an **interim posture**, currently enabled for
exactly one team. Three questions gate widening it and none is answered by
the feature working:

- do existing families need a **re-consent event**, having agreed under an
  unqualified "only your team" promise;
- do public-feed **viewers** need an age or role boundary — a
  self-registered adult is indistinguishable from a child today;
- is the **13+ cohort's self-approval** sound?

Two are legal reads. Launching with the feature gated to one team is a
perfectly good answer; launching with it open is not one to take by
default. Decision 9's monthly review is due **2026-09-16**.

### 2.3 The 180-day session token

`JWT_EXPIRES_IN` is 180 days. It is paired with a per-request
`token_version` revocation check, so a compromised session *can* be killed
— but the ACTION_PLAN has carried "180-day JWT with no revocation/reissue"
as an open pre-beta item, and a public launch is the moment to decide
whether that is the posture to go out on.

---

## 3. Not blocking, worth knowing

- **Helm chart** — still the one unchecked Fas 4 item. The plain manifests
  work and deploy on every merge; this is tidiness, not a blocker.
- **`Mobile lint` is advisory.** It has been clean since 2026-08-21 and is
  the one mobile check whose failures are crashes rather than opinions.
  Promoting it to required is a GitHub branch-protection setting, not a
  repo change.
- **The monthly sharing-consent reminder has never fired in production.**
  It is ADR-0030 Decision 5's only recurring control. With consent
  currently revoked it will not fire at all until sharing is switched back
  on. Since 2026-08-23 it logs a line whether or not anything was due, so
  its silence is now readable instead of ambiguous.
- **Crash reporting from the app now exists** (2026-08-23), and it changes
  what launch week looks like. Until now a render crash on a phone left no
  trace anywhere — survivable with one beta team you can ask in person, not
  survivable with strangers. Crashes now arrive in the console's Errors tab
  as `client` rows carrying the platform and the build.

  **It reaches nobody until an EAS build ships it.** The reporter is in
  `mobile/`, and the API deploying on merge does not build the app. If the
  store build predates this, launch week is still blind.
- **Two moderate advisories in `mobile/`'s Expo/Metro build tooling**, plus
  a handful in the backend's. All are denial-of-service in tooling that
  only ever sees this repo's own files. An attempt to override the
  backend's on 2026-08-22 broke `migration:run` and was reverted; see
  `backend/pnpm-workspace.yaml` for why it should not be retried blindly.

---

## 4. What is genuinely ready

Worth stating, because the list above is long and the foundations are not
the problem:

- Production runs on a real cluster with TLS, HSTS, DNS-01 renewal,
  health/uptime monitoring and a release pipeline that deploys on merge.
- The full parental-consent lifecycle works end to end in production —
  request, mail, approval, publish, revoke — proven 2026-08-21.
- Security headers, rate limits on every public route, encryption at rest
  for the two PII columns, structural team-scoping verified route by route,
  and no committed secrets.
- Nine languages with parity enforced in CI, and a marketing site that
  serves them.
- Self-service account erasure, working, with mailed confirm and cancel.

---

## The short version

Nothing on this list is a rewrite. The blockers are **a lawyer's sign-off
on the legal documents**, **two store forms**, **build capacity**, and — for
Play specifically — **the 14-day closed-test
clock** (§1.6). Two of those are calendar rather than
code, and between them they decide the date: the **iOS build quota** does
not reset until 1 September (§1.4), and the **Play closed-test clock**
needs 14 continuous days that have not started (§1.6). Neither shortens by
working faster. Upgrading the EAS plan is the only lever that moves the
iOS date at all.
