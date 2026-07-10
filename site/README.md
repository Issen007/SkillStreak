# site/ — public marketing page + hosted "try it" demo

Two things, one Docker image, served as two nginx virtual hosts:

- **`index.html`** — a static marketing/product page explaining what
  SkillStreak is, served at the root domain
  (`skillstreak.app2.isstech.io`). Includes a pre-generated QR code
  (`assets/qr.svg`) linking to the hosted demo.
- **The hosted demo** — the mobile app itself, exported for web
  (`npx expo export --platform web` in `mobile/`) and served at
  `try.skillstreak.app2.isstech.io`. Not built from source here; the
  Dockerfile's build stage runs the export against `mobile/` directly.

This is a purpose-built, from-scratch service — deliberately **not** an
adaptation of `tools/lab-access` (that tool's core feature, auto-detecting
*this laptop's* LAN IP, is meaningless once something is a pod in a
cluster; it's also explicitly local-dev-only and binds to every interface
with no auth, the wrong security posture for public exposure).

## Why two hostnames, not one path each

Metro's web export hardcodes asset paths rooted at `/` (e.g.
`/_expo/static/js/web/index-<hash>.js`), and this Expo CLI version has no
`--base-path`/`--public-path` flag to change that. Serving the export
under a subpath like `/app/` would 404 on every asset. Separate
subdomains sidestep the problem entirely — each host serves its content
from its own domain root. See `nginx.conf`'s comment for how one
container serves both.

## Rebuilding

The QR code and the exported app are both baked in at Docker build time,
not generated at runtime (unlike `lab-access`, which auto-detects a
LAN IP that can change between runs — this deployment's URLs are fixed,
so there's nothing to detect).

- **App changed?** Rebuild the image — `site/Dockerfile`'s build stage
  re-runs the export from `mobile/` fresh every time.
- **Public URL ever changes** (new domain, moved off this subdomain
  scheme, etc.)? Regenerate `assets/qr.svg`:
  ```bash
  node -e "
  require('qrcode').toString(
    'https://try.skillstreak.app2.isstech.io',
    { type: 'svg', margin: 1, width: 320 },
    (err, svg) => { if (err) throw err; require('fs').writeFileSync('site/assets/qr.svg', svg); }
  )"
  ```
  (needs the `qrcode` npm package — `tools/lab-access` already depends on
  it, or `npm install qrcode` anywhere temporarily.)
- Update the `href` in `index.html`'s `.cta` link to match.

## Known limitation: expo-secure-store on web

`mobile/src/api/authStorage.ts` falls back to `localStorage` when
`Platform.OS === 'web'`, since `expo-secure-store`'s web implementation is
an empty stub that throws on every call in the installed version. This is
a real (if minor) security reduction — no OS-level encryption-at-rest,
just plain `localStorage` — acceptable for a public demo session token,
not something to reuse for a real native-app credential path. See that
file's comment for the full reasoning.

## Building and testing locally

```bash
docker build -f site/Dockerfile \
  --build-arg EXPO_PUBLIC_API_URL=https://api.skillstreak.app2.isstech.io \
  -t skillstreak-site:local .

docker run -d --name skillstreak-site -p 8877:80 skillstreak-site:local
curl -H "Host: skillstreak.app2.isstech.io" http://localhost:8877/
curl -H "Host: try.skillstreak.app2.isstech.io" http://localhost:8877/
docker rm -f skillstreak-site
```
