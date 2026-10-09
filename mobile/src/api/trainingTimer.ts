import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { secureDeleteItem, secureGetItem, secureSetItem } from './secureStorage';
import type { ActivityType, TrainingTimerResponse } from './types';

/**
 * docs/adr/0038 Decision 2 — the one running countdown timer, kept on this
 * device so it survives the app being backgrounded or killed.
 *
 * The server owns the clock (`startedAt`/`endsAt`); this only remembers
 * which timer is open and what the server said, so the countdown can be
 * recomputed from `endsAt` on the next launch. Nothing about *where* the
 * child is goes in here or anywhere else — the timer records that a clock
 * ran, never a location.
 *
 * Stored through secureStorage like every other local flag in this app
 * (SecureStore on native, localStorage on web); no AsyncStorage.
 */

const STORAGE_KEY = 'skillstreak.activeTrainingTimer';

/** Fixed, so rescheduling replaces rather than duplicates, and so the
 * daily reminder's cancel-and-reschedule (trainingReminder.ts) can leave
 * this one alone. */
export const TIMER_NOTIFICATION_ID = 'skillstreak-training-timer-end';

/** ADR-0038: a timer older than this cannot verify a log. */
const MAX_TIMER_AGE_MS = 24 * 60 * 60 * 1000;

export interface ActiveTimer {
  timerId: string;
  activityType: ActivityType;
  plannedMinutes: number;
  startedAt: string;
  endsAt: string;
  /**
   * Server clock minus device clock, measured when the timer started.
   *
   * The countdown has to agree with the server about when time is up — a
   * phone whose clock runs two minutes fast would otherwise end the
   * countdown early and the server would credit two minutes fewer. Network
   * latency makes this slightly negative, which errs towards ending a hair
   * late: the safe direction.
   */
  clockOffsetMs: number;
}

export function activeTimerFromResponse(
  response: TrainingTimerResponse,
  activityType: ActivityType,
): ActiveTimer {
  return {
    timerId: response.timerId,
    activityType,
    plannedMinutes: response.plannedMinutes,
    startedAt: response.startedAt,
    endsAt: response.endsAt,
    clockOffsetMs: Date.parse(response.startedAt) - Date.now(),
  };
}

/** "Now" on the server's clock, as best this device can tell. */
export function serverNow(timer: ActiveTimer): number {
  return Date.now() + timer.clockOffsetMs;
}

export function remainingMs(timer: ActiveTimer): number {
  return Math.max(0, Date.parse(timer.endsAt) - serverNow(timer));
}

/** Whole minutes done so far, never more than planned — the same figure
 * the server will credit (ADR-0038 Decision 2 and 3). */
export function elapsedWholeMinutes(timer: ActiveTimer): number {
  const elapsed = Math.floor((serverNow(timer) - Date.parse(timer.startedAt)) / 60_000);
  return Math.max(0, Math.min(timer.plannedMinutes, elapsed));
}

function isActiveTimer(value: unknown): value is ActiveTimer {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.timerId === 'string' &&
    typeof v.activityType === 'string' &&
    typeof v.plannedMinutes === 'number' &&
    typeof v.startedAt === 'string' &&
    typeof v.endsAt === 'string' &&
    typeof v.clockOffsetMs === 'number' &&
    !Number.isNaN(Date.parse(v.startedAt)) &&
    !Number.isNaN(Date.parse(v.endsAt))
  );
}

export async function saveActiveTimer(timer: ActiveTimer): Promise<void> {
  await secureSetItem(STORAGE_KEY, JSON.stringify(timer));
}

/**
 * The open timer, or null. A stored timer the server would refuse anyway
 * (older than 24 hours) is dropped here rather than restored into a
 * countdown that can only end in an error.
 */
export async function loadActiveTimer(): Promise<ActiveTimer | null> {
  const raw = await secureGetItem(STORAGE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!isActiveTimer(parsed)) {
    await secureDeleteItem(STORAGE_KEY);
    return null;
  }
  if (serverNow(parsed) - Date.parse(parsed.startedAt) > MAX_TIMER_AGE_MS) {
    await clearActiveTimer();
    return null;
  }
  return parsed;
}

/** Forgets the timer and its end-of-timer notification. */
export async function clearActiveTimer(): Promise<void> {
  await Promise.all([secureDeleteItem(STORAGE_KEY), cancelTimerEndNotification()]);
}

/**
 * Announces the end of the countdown with a local notification.
 *
 * **Never asks for permission.** The only place this app asks is turning
 * on the daily reminder (ADR-0033, trainingReminder.ts), deliberately; a
 * child who has not granted it simply sees the countdown finish when they
 * next open the app, which is computed from `endsAt` either way. Failures
 * are swallowed — a missing notification must never stop a timer.
 */
export async function scheduleTimerEndNotification(
  timer: ActiveTimer,
  copy: { title: string; body: string },
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    // Convert the server's end time to this device's clock for the trigger.
    const fireAt = new Date(Date.parse(timer.endsAt) - timer.clockOffsetMs);
    if (fireAt.getTime() <= Date.now()) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('training-timer', {
        name: 'Träningstimer',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.scheduleNotificationAsync({
      identifier: TIMER_NOTIFICATION_ID,
      content: { title: copy.title, body: copy.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: Platform.OS === 'android' ? 'training-timer' : undefined,
      },
    });
  } catch {
    // Best effort, see above.
  }
}

export async function cancelTimerEndNotification(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(TIMER_NOTIFICATION_ID);
  } catch {
    // Nothing scheduled, or notifications unavailable — either way, done.
  }
}
