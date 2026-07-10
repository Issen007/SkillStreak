# lab-access

A tiny local SvelteKit (Svelte 5) tool: one page showing a QR code that
opens SkillStreak in Expo Go on whatever LAN this laptop is currently on.
Built for one specific annoyance — demoing/testing the app on a different
Wi-Fi each time means a new LAN IP each time, and `EXPO_PUBLIC_API_URL`
(mobile's backend URL) has to match it exactly (see
[`mobile/README.md`](../../mobile/README.md)'s "Running locally" section).
Leave this page open and it re-detects the current IP every few seconds —
no more `hostname -I`/`ip route` by hand before every demo.

This is a standalone dev/demo tool, not part of the SkillStreak product —
it has its own `package.json`/lockfile (there's no repo-wide pnpm
workspace), and is never built into the mobile app or deployed anywhere.

## Running it

```bash
cd tools/lab-access
pnpm install
pnpm run dev
```

Open `http://localhost:4400` on the laptop that's running the SkillStreak
backend (`docker compose up` from the repo root) and, ideally, Expo
(`npx expo start --lan` in `mobile/`). The page shows:

- A QR code encoding `exp://<detected-lan-ip>:8081` — scan it with a phone
  camera or inside Expo Go to open the app directly.
- The exact `EXPO_PUBLIC_API_URL=... npx expo start --lan` command for the
  currently-detected IP, with a copy button — run this in `mobile/`
  whenever the detected IP changes, since that env var is baked into the
  JS bundle at Expo's *start* time, not read at runtime (this page can't
  fix a stale bundle for you, only tell you the right command to restart
  with).
- A green/red dot showing whether `GET /health` actually responds at that
  IP:3000 right now, so you know before you start scanning whether the
  backend is even reachable from there.

If this laptop has more than one active network adapter (a VPN, a Docker
bridge, a second NIC — this project's own dev machine has all three
alongside its real Wi-Fi), the auto-detect heuristic excludes
obviously-wrong ones by name but isn't infallible. Expand "Fel nätverk
valt?" below the QR code to pick the right one manually; the page keeps
polling with your choice until you switch back to "Auto."

## Simulator tab

A second tab (`/simulator`) shows the actual live app — not a mockup —
inside a simple CSS iPhone/Android frame, via an iframe pointed at Expo's
web target (`expo start --web`, same Metro dev server, same port as the
`exp://` link above). A green/red dot shows whether that address is
actually responding before it tries to load the frame.

The address is editable, not just auto-detected: type any host/IP/port
(or a full URL) into the field and click "Använd" to point the frame at
it, or "Auto" to snap back to the detected LAN address. This is what
makes it work for cases auto-detection can't reach on its own — a
different Wi-Fi network, a phone hotspot, or (see
[`mobile/README.md`](../../mobile/README.md)'s "Testing from a different
network" section) a `https://*.exp.direct` tunnel URL from `expo start
--tunnel --web`, which needs no shared network with this laptop at all.
A manually-entered address gets its own client-side reachability check
(a `no-cors` fetch — good enough to tell "responds" from "doesn't", not
meant to read the actual response) since it wasn't one of the addresses
this tool detected itself.

## Why SvelteKit, not a plain static page

The core capability — reading this machine's actual network interfaces —
is a `node:os` call. A static HTML/JS page in a browser has no reliable,
cross-browser way to do that (browsers deliberately don't expose a page's
own LAN IP to JavaScript). SvelteKit's `+server.ts` route
(`src/routes/api/status/+server.ts`) gives this a real Node backend for
that one small job, and Svelte 5 (runes: `$state`/`$derived`/`$effect`) for
the polling UI, in one project with one dev command — no separate
frontend/backend split needed for something this small.

## Layout

- `src/routes/+layout.svelte` — shared shell (dark theme, page title) and
  the QR-kod/Simulator tab nav.
- `src/routes/+page.svelte` — the QR tab: polls `/api/status` every 3s,
  renders the QR client-side via the `qrcode` package (regenerated only
  when the URL actually changes, not on every poll tick, so an idle screen
  doesn't flicker), and the manual network-override picker.
- `src/routes/simulator/+page.svelte` — the Simulator tab: the
  iPhone/Android CSS frame, the editable URL field (falls back to
  `/api/status`'s detected `webUrl` until overridden), and its own
  client-side reachability probe for manually-entered addresses.
- `src/routes/api/status/+server.ts` — the one API route. Detects network
  candidates, picks a likely primary, probes that candidate's `/health`
  and the Expo web port.
- `src/lib/server/network.ts` — pure, unit-testable interface-detection
  logic (`os.networkInterfaces()` passed in as a parameter, not called
  internally, precisely so it can be tested without mocking `node:os`).
  Under `lib/server/` deliberately — SvelteKit refuses to let client code
  import anything under a `server/` directory, so this can never
  accidentally end up in a browser bundle.
- `src/lib/server/health.ts` — the `/health` probe, with a short timeout so
  a backend that isn't running yet just shows a red dot instead of hanging
  the status endpoint.

## Not built here

- Starting/restarting Expo or the backend for you — this tool only reads
  state and hands you the right command; it doesn't spawn or kill
  processes, deliberately (a webpage silently managing dev-server processes
  is a bigger footprint than "show me the current IP and the right
  command" needed to be).
- Any auth or access control — this binds to every interface
  (`vite.config.ts`) for convenience (pulling it up on a second screen,
  etc), same posture as Metro/the backend already have on this LAN during
  local dev. Local/demo use only, never deploy this anywhere reachable
  beyond your own LAN.
