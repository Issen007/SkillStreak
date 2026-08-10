# Running SkillStreak locally

Moved out of the README on 2026-08-10, which now explains the project and
points at the live site instead. Nothing here changed in the move — if you
want to *use* SkillStreak, try <https://try.skillstreak.xyz> and skip this
file entirely. This is for working on it.

## What you need

- **Docker** and **Docker Compose** — runs the API, Postgres and Redis.
- **Node.js 22+** and **[pnpm](https://pnpm.io)** — runs the mobile app.
- **[Expo Go](https://expo.dev/go)** on your phone, which must be on the
  **same Wi-Fi** as the machine running the backend.

## 1. Start the backend

```bash
git clone <repo-url>
cd SkillStreak
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d --build
```

That starts the NestJS API, Postgres and Redis, and runs the database
migrations automatically. Check it answers:

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"dev"}
```

Then seed test data — the entrypoint runs migrations only, never seed
data, so this is a separate step:

```bash
docker compose exec api node dist/scripts/seed.js
```

That creates the team **"IBK Falken P13"** with invite code **`FALKEN13`**.

### Parental-consent email (optional)

Without SMTP settings everything works except the actual send — the app
creates the account but no email reaches a parent. To test the whole flow
with a real link in a real message, fill in the SMTP fields in `.env`
(Google Workspace relay as the worked example; see the comments in
`.env.example`) before `docker compose up`.

Without real email you can still exercise the flow by approving by hand:

```bash
docker compose exec postgres psql -U app -d app_dev -c \
  "UPDATE player SET parental_consent_status = 'approved' WHERE screen_name = '<your-screen-name>';"
```

## 2. Start the mobile app

Find your machine's LAN address (the network your phone is on):

```bash
# Linux/macOS
ip addr show | grep "inet " | grep -v 127.0.0.1   # or: ifconfig
```

Then start Expo pointed at it:

```bash
cd mobile
pnpm install
EXPO_PUBLIC_API_URL="http://<YOUR-IP>:3000" npx expo start --lan
```

## 3. Connect your phone

Open **Expo Go** and scan the QR code Expo prints in the terminal — or, if
your Expo Go build has no scanner, choose **"Enter URL manually"** and type
`exp://<YOUR-IP>:8081`.

> **Expo Go version:** Expo Go supports only *one* SDK version at a time
> (currently SDK 54 here). An "incompatible" error almost always means an
> out-of-date Expo Go — update it from the App Store / Google Play.

> **Stale Metro bundler:** if you add a dependency and the app renders a
> blank screen with no error, restart Expo with `--clear`. A long-running
> Metro process will not pick up a newly installed package and fails
> silently rather than loudly.

## 4. Walk the flow

1. Enter the invite code **`FALKEN13`** (or your own, if you seeded one).
2. Pick a screen name, avatar, birth year, and a parent's email or phone.
3. You land on a waiting screen — the account exists but is locked until a
   parent approves, via the emailed link or the SQL above.
4. After approval: tap **"Jag har tränat"**, pick an activity and a
   duration, and watch the streak and the team's VM-Guld pot update.

## The staff console

The admin and trainer console is served by the API itself at
[http://localhost:3000/console/](http://localhost:3000/console/).

It is same-origin with the API on purpose — the `staff_session` cookie is
`SameSite=Strict` and outside the CORS block, so it only authenticates
from the API's own origin (ADR-0023 Decision B2).

Signing in needs OAuth credentials you probably do not have locally. To
work on anything *behind* the login without registering an OAuth app:

```bash
docker compose exec api node dist/scripts/mint-dev-staff-session.js
```

Your role comes from `ADMIN_EMAILS`: on that list you are an admin, off it
you are a trainer (`pt`). The role is re-derived on every sign-in, so
adding your address and signing in again is enough to promote an account.
An admin account cannot use the trainer view — `PtAuthGuard` refuses
admins deliberately, so seeing both means two accounts.

## Going beyond localhost

Change `APP_PUBLIC_URL` in `.env` (it is what the consent-email link points
at) to a reachable address, and see [k8s/README.md](../k8s/README.md) for
Kubernetes deployment.

Anything touching a URL, hostname, QR code or CORS origin must work in
**both** environments — production and the internal LAN cluster. The
mechanism is build-time, not runtime: CI builds separate images per
environment. See CLAUDE.md's "Environment parity" section before changing
any of it.
