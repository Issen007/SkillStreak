# Adding a staff SSO provider

How to turn on Microsoft and Apple sign-in for the staff console
(trainers and admins). Google is already live.

**This is entirely portal work and secret-setting.** No code changes are
needed: all three providers are implemented, the CI wiring passes all
eight keys into the cluster Secret, and `k8s/api-deployment.yaml` maps
every one of them into the pod. Verified 2026-08-24. The only reason
Microsoft and Apple answer `503` today is that their secrets have never
been set — `gh api .../actions/secrets` lists only the two Google ones.

**Do this yourself rather than handing the values to anyone, including an
assistant.** A client secret and an Apple `.p8` are long-lived
credentials; they belong in GitHub's secret store and nowhere else — not
in a chat, an issue, a commit or an email, each of which keeps a copy.

---

## The redirect URI, which both providers need

Built by the app as `${APP_PUBLIC_URL}/api/v1/staff-auth/<provider>/callback`
(`staff-oidc-clients.service.ts`). With production's `APP_PUBLIC_URL`:

| Provider | Redirect / return URL |
|---|---|
| Microsoft | `https://api.skillstreak.xyz/api/v1/staff-auth/microsoft/callback` |
| Apple | `https://api.skillstreak.xyz/api/v1/staff-auth/apple/callback` |

It must match exactly — scheme, host, path, no trailing slash.

---

## Microsoft

The app discovers Microsoft at
`https://login.microsoftonline.com/common/v2.0`. **`common` is the
load-bearing part**: it accepts both work/school accounts and personal
Microsoft accounts, which is what you want for coaches whose club runs on
Outlook and who may sign in with either.

1. **Azure Portal → App registrations → New registration.**
2. **Supported account types:** *Accounts in any organizational directory
   and personal Microsoft accounts.* Anything narrower will reject half
   the trainers you are trying to reach, and it will look like a broken
   login rather than a configuration choice.
3. **Redirect URI:** platform **Web**, the Microsoft URL above.
4. **Certificates & secrets → New client secret.** Copy the **Value**,
   not the Secret ID — they sit next to each other and the ID is the one
   that silently does not work.

   **This is not a hypothetical warning.** It happened on the first
   attempt, 2026-08-26, and cost an afternoon. The tell, if you want to
   check what you pasted without revealing it: a Secret **ID** is a
   36-character UUID (`8-4-4-4-12` hex with dashes); a secret **Value** is
   around 40 characters of mixed case with `~`, `.` and `-` in it, and is
   never a UUID. If your stored secret looks like a UUID, it is the wrong
   field.

   Azure shows the Value once. If you navigated away, you cannot retrieve
   it — delete that secret and create a new one.
5. Scopes are `openid email profile`, which are default and need no admin
   consent. Nothing to configure.

Set two GitHub secrets:

| Secret | Value |
|---|---|
| `MICROSOFT_OAUTH_CLIENT_ID` | the Application (client) ID |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | the client secret **Value** |

Client secrets expire (24 months maximum, and Azure defaults to less).
Put the expiry date somewhere you will see it — an expired secret fails
exactly like a misconfiguration.

---

## Apple

More involved, and the client id is **not** the app's bundle identifier.

1. **Apple Developer → Certificates, Identifiers & Profiles →
   Identifiers → new Services ID.** This is what becomes the client id
   (something like `xyz.skillstreak.signin`). `xyz.skillstreak.app` is
   the *app*, and using it here does not work.
2. Enable **Sign in with Apple** on that Services ID and configure it:
   - **Domain:** `api.skillstreak.xyz`
   - **Return URL:** the Apple URL above
3. **Keys → new key**, enable *Sign in with Apple*, download the `.p8`.
   **Apple lets you download it once.** Losing it means making a new key.

Set four GitHub secrets:

| Secret | Value |
|---|---|
| `APPLE_OAUTH_CLIENT_ID` | the **Services ID**, not the bundle id |
| `APPLE_TEAM_ID` | `VMD23MJDNG` (from `mobile/eas.json`) |
| `APPLE_KEY_ID` | the key's 10-character id |
| `APPLE_PRIVATE_KEY` | the `.p8` contents — **see below** |

### The `.p8` newline gotcha

`buildAppleClientSecret` does `.replace(/\\n/g, '\n')` on the value. So
the secret must contain **literal backslash-n**, not real line breaks:

```
-----BEGIN PRIVATE KEY-----\nMIGTAgEA...\n-----END PRIVATE KEY-----\n
```

Pasting the file with real newlines produces a signing failure whose
message says nothing about newlines. This is the single most likely thing
to go wrong in this document.

### Two Apple behaviours worth knowing before you test

- **The name is sent once, ever.** Apple returns `name` only on the first
  authorization for a given Services ID. The code already knows —
  `refreshExistingAccount` never refreshes Apple claims, so the values
  stored at first login stand. If you test, delete, and re-test with the
  same Apple ID, the name will not come back.
- **Apple posts the callback** (`response_mode=form_post`, required
  whenever `name`/`email` scope is requested). The app handles it; it is
  mentioned only because it explains why the return URL must be exact.

---

## Deploying, and the failure this project has already had

**Setting a GitHub secret changes nothing on its own.** CI regenerates
`skillstreak-secret` from those secrets during the deploy job, and pods
read env at start — so a secret needs a deploy *after* it was set, and
that deploy has to restart the pods.

An SMTP password was once correct in GitHub and absent from the cluster
for three deploys because that order was assumed rather than checked.

**And a green deploy did not used to mean restarted pods.** Found doing
this for Microsoft on 2026-08-26: `kubectl apply` only rolls a Deployment
whose *spec* changed, and on a same-commit run the image tag does not. So
the dispatch run applied the new Secret, left both pods running two-day-old
processes with an empty `MICROSOFT_OAUTH_CLIENT_ID`, and `rollout status`
reported success — of the old ReplicaSet, which was indeed healthy. It
took a manual `kubectl rollout restart deployment/api`.

The deploy job now restarts `api` and `site` unconditionally, so this
should not recur. If you are ever deploying a config change from a branch
that predates that fix, restart by hand:

```bash
kubectl --context=skillstreak -n skillstreak rollout restart deployment/api
```

After the next merge to `main`, verify against the running API rather
than the portal:

```bash
curl -s https://api.skillstreak.xyz/api/v1/staff-auth/providers
```

Expect `{"providers":["google","microsoft","apple"]}`. Anything missing
from that list is not configured as far as the running app is concerned,
whatever the portal shows — and the sign-in page draws only the providers
this endpoint returns, so a missing one is invisible to a trainer rather
than broken.

A provider that is listed but misconfigured fails at the callback, not at
the button. Test each one by actually signing in.

---

## Microsoft: done 2026-08-26

Secrets set, deployed, pods rolled, verified:

```
GET /api/v1/staff-auth/providers  ->  {"providers":["google","microsoft"]}
GET /api/v1/staff-auth/microsoft/login  ->  302 to
    login.microsoftonline.com/common/oauth2/v2.0/authorize
    redirect_uri=https://api.skillstreak.xyz/api/v1/staff-auth/microsoft/callback
    scope=openid email profile   response_type=code
```

Following that redirect returns Microsoft's own sign-in page, HTTP 200,
**with no `AADSTS` error** — which is the useful signal: a wrong client id
gives `AADSTS700016` and a mismatched redirect URI gives `AADSTS50011`,
both on that page rather than at our callback.

**A real sign-in completed at 08:23** — a `microsoft` staff account row
exists with email and display name populated, and no callback error has
been recorded since. Done.

### It took two attempts, and the first one is the lesson

The first attempt failed with `oauth_callback_rejected` because
`MICROSOFT_OAUTH_CLIENT_SECRET` held Azure's Secret **ID** rather than its
**Value** — see the warning in the Microsoft section above, which existed
and still did not survive contact with two adjacent columns.

Worth knowing for next time: the shape check catches it without anyone
revealing a secret. 36 characters and UUID-shaped is the ID; ~40
characters of mixed case with punctuation is the Value.

### The role a new account gets

Every account is created `pt` unless its email is in `ADMIN_EMAILS`,
which currently holds one address. So **signing in with a second identity
gives you a trainer account, not an admin one** — the Microsoft sign-in
above produced `role=pt`. That is correct behaviour and is worth
expecting rather than debugging: if you want that identity to be an
admin, add its address to the `ADMIN_EMAILS` secret and redeploy.

The role is also refreshed from the allow-list on every Google/Microsoft
login, so adding the address is enough — no database edit.

---

## Apple: configured 2026-08-26

All four secrets set, deployed, pods rolled by the deploy itself (the CI
fix landed in between). Verified:

```
GET /api/v1/staff-auth/providers -> {"providers":["google","microsoft","apple"]}
GET /api/v1/staff-auth/apple/login -> 302 to appleid.apple.com/auth/authorize
    client_id=xyz.skillstreak.signin          <- the Services ID, not the bundle id
    redirect_uri=https://api.skillstreak.xyz/api/v1/staff-auth/apple/callback
    scope=openid email name   response_mode=form_post
```

Following that reaches Apple's own sign-in page, HTTP 200, no
`invalid_client` or `redirect_uri_mismatch`.

**The shapes were checked in the cluster before anyone attempted a
sign-in**, which is the habit worth keeping from the Microsoft round —
there, a wrong value was only discovered by a failed login and a
subsequent hunt. Nothing about the check reveals a value:

```
APPLE_OAUTH_CLIENT_ID  22 chars, not the bundle id
APPLE_TEAM_ID          matches mobile/eas.json
APPLE_KEY_ID           10 chars, as Apple issues
APPLE_PRIVATE_KEY      PEM markers present, literal \n escapes present,
                       real newlines absent   <- the documented trap, avoided
```

Still unproven until a person signs in: the private key actually *signs* a
client secret Apple accepts. That happens at the token exchange, and a bad
key fails there rather than at the button. `StaffOAuthProviderRejectedException`
now names that case in the error log, so a failure will say which half
broke.
