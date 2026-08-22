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

### 1.3 The store declarations are not filled in

Neither Apple's App Privacy nor Play's Data Safety form has been completed.
They must be answered **from the schema, not from memory** — the security
review found the privacy policy itself had drifted from the code, and these
forms are the same risk with a worse failure mode.

The honest answers are unusually good and worth using deliberately: no
location ever, no ads, no in-app purchases, no third-party analytics or
tracker SDK, parental consent gating media, screen names by default,
EXIF/GPS stripped on upload, retention windows enforced by scheduled
sweeps, and self-service erasure that works.

### 1.4 Build capacity

The EAS free tier is spent (project owner, 2026-08-22), and store
submission needs builds. Nothing else on this list can be finished without
resolving that — either by waiting for the quota to reset or by paying for
a plan.

### 1.5 Android is far behind

Latest Android build is **build 2, from 2026-08-17**. iOS is on build 14.
Everything from the last five days — the consent-link fix, the clip menu,
the whole signup form, the caption change — exists only on iOS. A Play
submission today would ship a version that predates most of this month.

---

## 2. Decisions only the project owner can make

### 2.1 Apple's Kids Category, or a general app with an age rating

Two different regimes, and the choice is deliberate. Kids Category is
stricter — no behavioural advertising, a parental gate on anything leaving
the app, no external links without one — and it signals exactly what this
app is. A general listing with an age rating is easier and says less.

This decision changes the answers to several store questions, so it comes
before filling the forms in — and it now decides one piece of code: the
profile screen's privacy-policy link leaves the app, which Kids Category
would require a parental gate in front of (§1.2).

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
  on.
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
on the legal documents**, **two links**, **two store forms**, **build
capacity**, and **an Android build**. The first is the long pole and the
only one that cannot start today.
