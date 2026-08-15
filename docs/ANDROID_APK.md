# Building an Android APK testers can install

No Google account and no Play Store. An APK is a file: you build it, send
a link, they install it. This is the cheapest way to get SkillStreak onto
a real home screen, and it works today.

## One-time setup

You need a free Expo account (done) and the project registered with EAS.

```bash
cd mobile
npx eas-cli login          # your Expo account
npx eas-cli init           # writes extra.eas.projectId into app.json
```

`eas init` is the step that matters: `app.json` currently has no
`projectId`, so no build can be attributed to a project until it runs. It
edits `app.json` — commit that change.

## Each build

```bash
cd mobile
npx eas-cli build --platform android --profile preview
```

It runs on Expo's servers, takes 10–20 minutes, and ends with a URL. Open
that URL on an Android phone and it installs. Android will warn about
installing outside the Play Store; that warning is expected and is the
price of not needing a store.

## Which profile, and why it matters

| Profile | API it talks to | Output | Use |
|---|---|---|---|
| `development` | `localhost:3000` | aab | dev client, your machine |
| `internal` | `192.168.55.71` | apk | **your LAN only** |
| `preview` | `api.skillstreak.xyz` | **apk** | **testers, anywhere** |
| `production` | `api.skillstreak.xyz` | aab | Play Store upload |

**Use `preview` for testers.** The two traps this table exists to prevent:

- **`internal` bakes a LAN address.** An APK built from it works on your
  wifi and nowhere else, and it fails in a confusing way — the app opens
  and then cannot reach anything.
- **`production` builds an AAB, which cannot be sideloaded.** Android
  App Bundles are a Play Store upload format; a tester cannot install
  one. If you send an `.aab` and someone says "it won't open", this is
  why.

`EXPO_PUBLIC_API_URL` is baked in at build time, so which profile you
chose is fixed in the file. There is no runtime switch — the same
build-time-not-runtime rule CLAUDE.md's environment-parity section
describes for the web build applies here.

## What was removed and why

The `internal` and `production` profiles carried `"channel": "internal"`
and `"channel": "production"`. A channel is an EAS Update concept and
requires `expo-updates`, which this app does not install. Left in place
they make the first build fail on a config error that has nothing to do
with the app. If EAS Update is ever set up, add them back with it.

## iOS from the same setup

Once the Apple Developer account is active:

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

`eas.json`'s `submit.production.ios` block still has three placeholders —
`appleId`, `ascAppId`, `appleTeamId` — which come from App Store Connect.
See `docs/RELEASING.md`.

There is no iOS equivalent of sideloading an APK. TestFlight Internal is
the closest thing, and it needs the paid account.
