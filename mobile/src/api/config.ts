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
