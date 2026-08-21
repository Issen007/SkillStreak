# 0032 - A native trainer surface in the app

## Status

Proposed, 2026-08-21. Asked for directly by the project owner:

> "Can we have the trainer view in the app and not a external website?"

Offered three shapes — an in-app browser sheet, fully native screens, or
the sheet now with native later — and **fully native** was chosen.

Extends ADR-0023 (PT role and staff SSO/RBAC) and ADR-0031 (linking a
player and a trainer account). Supersedes neither. ADR-0023's Decision on
cookie-based staff sessions is **amended, not replaced**: the browser
keeps the cookie exactly as it is.

---

## Context

### Why this is an authentication decision, not a screens decision

The trainer surface exists and works. It is four screens in
`backend/console/`, and the app currently opens them in a browser.

What stops those screens being rewritten in React Native is not effort.
It is that **`StaffAuthGuard` reads exactly one thing**: a
`staff_session` cookie, `SameSite=Strict`, same-origin with the API.

That cookie was chosen deliberately, and it is genuinely strong:

- JavaScript cannot read it (`httpOnly`)
- it is never sent cross-site, so a malicious page cannot ride it
- it lives in the browser's own protected storage
- the console must be served *by the API* for it to work at all — which
  is why `main.ts` serves `/console` rather than the site doing it

**A mobile app can hold none of that.** There is no cookie jar to borrow.
Native screens therefore require the guard to accept a **bearer token**,
and that token is an adult credential for children's training data
sitting in device storage.

That is the decision. Everything else here is consequence.

### What makes it acceptable, stated before the mitigations

The honest argument is not "we will store it carefully". It is that
**ADR-0023 already made a trainer credential a poor thing to steal.**

A staff identity grants nothing on its own. Access comes from
`PtTeamLink` rows a captain created and per-child consents a parent
approved, both re-checked live on every request. A stolen trainer token
is therefore worth exactly the relationships that trainer already had —
not a step up, and not a way into any other family's data.

Compare a player's JWT, which is 180 days, unrevocable, and grants that
child's whole account. The trainer token designed below is *stronger*
than a credential this app already ships.

That is the real basis for saying yes. The storage choices below reduce
the exposure; they do not create the permission.

---

## Decision — 1: the bearer token authorises PT routes only, never admin

`StaffAuthGuard` gains bearer support. `AdminAuthGuard` does not.

An account with `role: admin` signing in on mobile gets a token that
works on `/pt/*` and is refused by every `/admin/*` route, including for
the same person who could reach them from a browser two minutes earlier.

**This is the single most valuable line in this ADR.** Admin routes reach
across every family in the system; PT routes reach only where a captain
and a parent have already let this trainer in. Putting the wide
capability behind the strong credential (browser cookie plus ADR-0022's
step-up) and the narrow one behind the weaker credential keeps the
blast radius of a stolen phone proportionate.

Admin tooling is operator work done occasionally at a desk. Nothing is
lost by leaving it in the browser, and a great deal is risked by not.

## Decision — 2: a distinct token, not the cookie's JWT handed over

The mobile token is signed with the same key but carries `aud: "mobile"`;
the cookie carries `aud: "console"`. Each is rejected where the other
belongs.

Without this, one token type is silently interchangeable with the other:
a cookie value lifted from a browser would work as a bearer, and a
device token would work if injected as a cookie. Separating them costs
one claim and one check, and means the two can be expired, rotated or
revoked independently — which matters the first time a device is lost.

## Decision — 3: short-lived access, revocable refresh

| | Browser cookie | Mobile |
|---|---|---|
| Access | session-length | **1 hour** |
| Refresh | n/a | **30 days, server-side revocable** |

The browser session can be long because the browser protects it. A
bearer token in device storage cannot make that claim, so it expires
fast and is renewed against a refresh token that can be killed centrally.

Revocation is the property that matters. Today, revoking a staff account
relies on `revoked_at` being re-read per request — which works, and
which this preserves — but a refresh token gives a second, narrower
lever: end one device without ending the account.

## Decision — 4: native platforms only; the web build has no trainer mode

`mobile/src/api/secureStorage.ts` falls back to `localStorage` on web,
and says so in its own comment: *"real reduction in protection — no
OS-level encryption-at-rest"*. That is an accepted trade for a child's
session on the public try-it demo. It is not acceptable for an adult
credential that reaches other families' children.

So the trainer surface checks `Platform.OS` and renders nothing on web.
Not a disabled state — absent, the same posture the rollout allow-list
already takes: nothing is advertised that cannot be used safely.

The web build is the try-it demo. A trainer using it should open the
console, where the cookie is stronger than anything the app could offer.

## Decision — 5: reuse the backend's OIDC; the app never talks to a provider

The app does not embed Google/Microsoft/Apple client secrets or run its
own OIDC. It opens the **existing** backend endpoint in a system browser
(`expo-web-browser`), the backend completes the provider round trip
exactly as it does for the console, and then redirects to a deep link
carrying a **one-time, short-lived exchange code**. The app posts that
code back and receives the token pair.

Two reasons this shape rather than `expo-auth-session` against the
providers directly:

1. **No second OIDC implementation.** The backend's client registration,
   redirect URIs, `ADMIN_EMAILS` gating and account-creation rules stay
   the single source of truth. A parallel client in the app would be a
   second place for those rules to drift.
2. **The exchange code is the same pattern ADR-0031 already uses** for
   account linking — short-lived, single-use, worthless on its own. One
   idea, used twice, rather than two mechanisms to reason about.

**Prerequisite:** `mobile/app.json` has no `scheme`. One must be added
(`skillstreak`) and its redirect URI registered with each provider.

## Decision — 6: PT1–PT4 go native; the console stays and stays canonical

The four trainer screens are rebuilt in React Native. The console keeps
them too — it is the only surface on web, the only one for admins, and
the fallback when a native build is stale (which, as of today, is a
thing this project has to plan for).

Where the two disagree, **the server is right**. Neither client is
allowed to hold trainer state the other cannot see; both read the same
endpoints.

---

## Consequences

**New:** bearer support in `StaffAuthGuard`; an `aud` claim on both token
types; a `staff_refresh_token` table with revocation; a token-exchange
endpoint; a deep-link scheme and provider redirect registration; four
native screens; a mode switch that appears only when ADR-0031's link
exists and only on native.

**Unchanged, deliberately:** `AdminAuthGuard`, ADR-0022's step-up, the
console, `PtTeamLink`, and every per-child consent check. If implementing
this requires touching a consent path, the implementation has left this
ADR.

**Invariants worth testing first**, because each is silent when broken:

1. A `mobile`-audience token is refused by every `/admin/*` route.
2. A `console`-audience cookie value is refused as a bearer, and vice
   versa.
3. An expired access token fails closed; a revoked refresh token cannot
   mint a new one.
4. The trainer surface does not render on `Platform.OS === 'web'`.
5. The exchange code is single-use and expires.
6. A trainer with no `PtTeamLink` sees an empty surface, not an error —
   the same "powerless until invited" state ADR-0023 relies on.

**Open for the project owner:** whether a lost device should be
revocable by the trainer themselves from the console (recommended, and
cheap once refresh tokens exist), or only by an admin.
