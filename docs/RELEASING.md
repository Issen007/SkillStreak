# Releasing to the App Store and Google Play

Written 2026-08-10, for the project owner. Covers what it costs, how to
get a test build onto a phone, and what has to be true before either store
will accept an app aimed at children.

> **Verify prices and policy details before acting on them.** Both stores
> change fees and requirements without much notice, and this document will
> go stale. Every figure below is marked with where to check it.

---

## 1. What it costs

| Thing | Cost | Notes |
|---|---|---|
| Apple Developer Program | **~$99 / year**, recurring | Required to ship anything, including a TestFlight build. [developer.apple.com/support/enrollment](https://developer.apple.com/support/enrollment/) |
| Google Play Console | **~$25, one-time** | Lifetime, per account. [play.google.com/console/signup](https://play.google.com/console/signup) |
| EAS Build (cloud) | Free tier, then paid | The free tier is limited per month and queues behind paid users. You can build **locally for free** (`eas build --local`) if you have macOS for the iOS build. [expo.dev/pricing](https://expo.dev/pricing) |
| Apple Distribution certificate | Included | EAS generates and manages it. |

**Realistic minimum to be on both stores: ~$125 in year one, ~$99/year
after.** Everything else is time.

**Apple's is the one with a deadline attached** — let it lapse and your
app is removed from sale until you renew.

---

## 2. Before anything: the one string you cannot change later

`app.json` now sets:

```
ios.bundleIdentifier = "xyz.skillstreak.app"
android.package      = "xyz.skillstreak.app"
```

**These are permanent from the moment you first publish**, on both stores.
Not "hard to change" — genuinely impossible without shipping a different
app and losing every install and review.

**The name is decided: SkillStreak** (project owner, 2026-08-10), so these
values are confirmed rather than provisional and the store listing name
follows from it. They derive from `skillstreak.xyz`, a domain you own,
which is the right shape for a bundle ID.

Nothing in this document is name-blocked any more. The permanence note
above still matters — change them now if you are ever going to, because
after the first publish you cannot.

---

## 3. Can you do a prerelease? Yes, on both — and they work differently

### iOS — TestFlight

| Track | Testers | Review needed? | Speed |
|---|---|---|---|
| **Internal** | Up to 100, must be on your App Store Connect team | **No** | Minutes after processing |
| **External** | Up to 10,000 | **Yes** — Beta App Review | Usually a day or two, first time slower |

Internal TestFlight is the fastest honest test of a real build. Start there.

### Android — Play Console testing tracks

| Track | Testers | Speed |
|---|---|---|
| **Internal testing** | Up to 100, by email | Minutes |
| **Closed testing** | Larger, by list or group | Hours to days |
| **Open testing** | Public opt-in | Reviewed like production |

**The gotcha that catches people out:** Google requires newer **personal**
developer accounts to run a **closed test with a minimum number of testers
for a continuous period (currently ~12 testers over 14 days)** before
production access is granted at all. Organisation accounts have different
rules. If this applies to you it is on the critical path — start the closed
test early, because no amount of finished code shortens 14 days.
Check the current rule at
[support.google.com/googleplay/android-developer](https://support.google.com/googleplay/android-developer/answer/14151465).

**Recommendation:** register the Google account first, even before the app
is ready, precisely because of that clock.

---

## 4. The part that is genuinely harder for this app: it is aimed at children

Both stores treat a child-directed app as a separate category with extra
requirements. **This is not paperwork — it is the most likely reason a
first submission gets rejected**, and a child-safety rejection is slower
and more visible than an ordinary one.

### What both stores will ask

- **Target age group.** Answer honestly: 9–13 is the actual audience.
  Declaring "everyone" to dodge the extra rules is both dishonest and
  fragile — being caught misdeclaring a child-directed app is materially
  worse than the rules themselves.
- **A public privacy policy URL.** Must be reachable, must describe what
  is collected about children specifically. This app's substance already
  exists in `docs/legal/` and the ADRs; it needs publishing at a stable
  URL (`skillstreak.xyz/privacy` is the obvious home).
- **Data safety / App Privacy declarations.** Itemised: what is collected,
  whether it is linked to identity, whether it is shared. Answer from the
  actual schema, not from memory.
- **Third-party SDKs.** Both stores restrict what a child-directed app may
  embed. This app currently has no analytics SDK, no ad SDK and no tracker
  — which is an advantage worth keeping. Adding one later changes these
  answers.

### Where this app already stands well

Genuinely useful when filling in the forms — all of it is already true:

- No location collected anywhere, by design (CLAUDE.md non-negotiable).
- No ads, no in-app purchases, no third-party analytics.
- Parental consent gates media upload; a child's real name is optional and
  a screen name is the default.
- Video is team-scoped only, EXIF/GPS stripped on upload, with a retention
  window.
- Self-service account erasure exists and works.

### Where it needs attention before submitting

- **Apple's Kids Category** carries extra rules (no behavioural
  advertising, a parental gate on anything leaving the app, no external
  links without one). Decide deliberately whether to enter that category
  or ship as a general app with an age rating — they are different
  regimes. Kids Category is stricter but signals exactly what this app is.
- **The privacy policy must be published** before submission.
- **Account deletion must be reachable** — both stores now require an
  in-app path to delete your account for apps that support account
  creation. This app has one (Profile → erasure); confirm it is findable.

---

## 5. Step by step, the first time

### One-time setup

1. **Decide the app name** (§2). Everything below encodes it.
2. Enrol in the **Apple Developer Program** (~$99/yr). Allow days for
   identity verification.
3. Create a **Google Play Console** account (~$25). Start any required
   closed test clock immediately (§3).
4. Publish the **privacy policy** at a stable URL.
5. `npm install -g eas-cli && eas login && eas init` in `mobile/`.

### Each build

```bash
cd mobile

# A real installable build for you and testers
eas build --profile internal --platform all

# A store-bound build
eas build --profile production --platform all
```

`eas.json` defines three profiles: `development` (dev client, localhost
API), `internal` (LAN API, APK for sideloading) and `production` (the real
`api.skillstreak.xyz`). They mirror the environment split CI already uses
for Docker images — see CLAUDE.md's environment-parity section.

### Submitting

```bash
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

Fill in the `REPLACE_WITH_*` values in `eas.json`'s `submit` block first
(Apple ID, App Store Connect app id, Apple team id) and put the Play
service-account JSON at `secrets/play-service-account.json` — **gitignored,
never committed**, same posture as `k8s/secret.yaml`.

### What you still have to do by hand, in each store's console

- Screenshots per device class.
- Description, in at least Swedish and English.
- Age rating questionnaire.
- Data safety / App Privacy answers.
- The privacy policy URL.

---

## 6. Recommended order

1. **Register both accounts now.** They cost the least and take the
   longest — the Google closed-test clock in particular is unforgiving.
2. **Decide the name.** It blocks the bundle identifier, which blocks
   everything after it.
3. **Internal TestFlight + Play internal track.** A real build on a real
   phone will find things the web build never could — the clip upload flow
   especially, which has only ever run in a browser.
4. **Publish the privacy policy.**
5. **Then submit**, with the child-safety questions answered from the
   schema rather than from memory.

Expect the first review to take longer than later ones, and expect at
least one round of questions on a child-directed app. That is normal, not
a sign something is wrong.
