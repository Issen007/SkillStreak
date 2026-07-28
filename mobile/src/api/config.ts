import { Platform } from 'react-native';

// Base URL resolution for the Phase 1 NestJS backend (docker-compose,
// see docs/api/phase1-contract.md).
//
// - Override with EXPO_PUBLIC_API_URL (Expo inlines EXPO_PUBLIC_* env vars
//   at build/start time) — needed for a physical device on the same Wi-Fi
//   ("http://<your-lan-ip>:3000") or a non-default docker-compose port.
// - Otherwise: iOS Simulator can reach the host machine via `localhost`
//   directly, but the Android Emulator's `localhost` refers to the
//   emulator itself, not the host — it needs the special alias
//   `10.0.2.2`. This only covers the emulator; a physical Android/iOS
//   device still needs the EXPO_PUBLIC_API_URL override above.
function resolveDefaultBaseUrl(): string {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
}

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? resolveDefaultBaseUrl();

// Fixed per docs/api/phase1-contract.md's "Conventions" section.
export const API_PREFIX = '/api/v1';

// The marketing site's own public base URL — a completely separate origin
// from API_BASE_URL above (this app talks to the API directly, but has no
// other reason to know about the site at all). Added 2026-07-26 for the
// "invite a friend" share feature (Laget tab): the share link/QR code
// needs somewhere a friend without the app installed can actually open to
// join, and the site's own onboarding widget (site/index.html) is that
// somewhere — see its ?code= query-param support, added alongside this.
// Same "PLACEHOLDER + build-arg" convention as EXPO_PUBLIC_API_URL, wired
// through site/Dockerfile's mobile-build stage.
export const JOIN_URL_BASE: string =
  process.env.EXPO_PUBLIC_JOIN_URL ?? 'http://localhost:8080';

// A live `npx expo start` dev server's exp:// URL (e.g.
// "exp://192.168.55.30:8081") — added 2026-07-27 so InviteFriendSheet's
// QR can open Expo Go directly instead of the website. Empty/undefined by
// default: this is a manually-started dev-server process, not a stable
// deployed service, so there's no sensible default and CI/real builds
// never set it. `null` (not the empty string) lets callers tell "not
// configured" apart from "configured as empty" unambiguously.
export const EXPO_GO_URL: string | null = process.env.EXPO_PUBLIC_EXPO_GO_URL || null;
