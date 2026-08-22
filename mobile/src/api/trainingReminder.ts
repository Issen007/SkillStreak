import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { secureGetItem, secureSetItem } from './secureStorage';

/**
 * ADR-0033 — the daily "time to train" reminder.
 *
 * Entirely local: scheduled on this device, never involving the server.
 * The server does not know whether a child has a reminder and does not
 * need to. No push token exists anywhere in this app, which is what keeps
 * this out of the store data-safety forms and out of the privacy policy's
 * personal-data categories.
 *
 * **The bounds in here are the decision, not defaults.** One notification
 * a day, only between `EARLIEST_HOUR` and `LATEST_HOUR`, no escalation,
 * and nothing at all on a day already logged. This app exists to pull
 * children away from compulsion loops; a streak-urgency reminder engine
 * would be the same mechanic wearing a different coat.
 */

/** Hard bounds, so a reminder can never land at bedtime or wake a child. */
export const EARLIEST_HOUR = 8;
export const LATEST_HOUR = 20;

const ENABLED_KEY = 'skillstreak.trainingReminder.enabled';
const HOUR_KEY = 'skillstreak.trainingReminder.hour';
const DEFAULT_HOUR = 17;

/** Every hour the picker may offer. Bounded by construction — see above. */
export function selectableHours(): number[] {
  return Array.from(
    { length: LATEST_HOUR - EARLIEST_HOUR + 1 },
    (_, i) => EARLIEST_HOUR + i,
  );
}

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const [enabled, hour] = await Promise.all([
    secureGetItem(ENABLED_KEY),
    secureGetItem(HOUR_KEY),
  ]);
  const parsed = hour === null ? NaN : Number(hour);
  return {
    enabled: enabled === 'true',
    // A stored hour outside the bounds can only come from an older build
    // or a hand-edited store; clamp rather than trust it.
    hour:
      Number.isInteger(parsed) && parsed >= EARLIEST_HOUR && parsed <= LATEST_HOUR
        ? parsed
        : DEFAULT_HOUR,
  };
}

async function persist(settings: ReminderSettings): Promise<void> {
  await Promise.all([
    secureSetItem(ENABLED_KEY, settings.enabled ? 'true' : 'false'),
    secureSetItem(HOUR_KEY, String(settings.hour)),
  ]);
}

/**
 * Asks only when the child turns the reminder on.
 *
 * Never on first launch: a permission prompt before the app has earned
 * anything is one more thing to dismiss, and a denied prompt is much
 * harder to recover than one that was never shown.
 */
async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Schedules the single daily reminder, replacing any existing one.
 *
 * `cancelAll` first is deliberate: this app schedules exactly one
 * notification ever, so "cancel everything then schedule one" cannot leave
 * a duplicate behind — which is the failure mode that turns one calm
 * reminder into several.
 */
async function schedule(hour: number, body: string, title: string): Promise<void> {
  await cancelAll();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('training-reminder', {
      name: 'Träningspåminnelse',
      importance: Notifications.AndroidImportance.DEFAULT,
      // No sound and no vibration: a nudge, not an alarm.
      sound: null,
      vibrationPattern: null,
      enableVibrate: false,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: false },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
      channelId: Platform.OS === 'android' ? 'training-reminder' : undefined,
    },
  });
}

/**
 * Turns the reminder on or off, and reports what actually happened.
 *
 * Returns `false` when the OS refused, so the caller can say so rather
 * than showing a toggle that looks on and does nothing — a silently
 * ineffective switch is worse than an honest failure.
 */
export async function setReminderEnabled(
  enabled: boolean,
  hour: number,
  copy: { title: string; body: string },
): Promise<boolean> {
  if (!enabled) {
    await cancelAll();
    await persist({ enabled: false, hour });
    return true;
  }
  if (!(await ensurePermission())) {
    await persist({ enabled: false, hour });
    return false;
  }
  await schedule(hour, copy.body, copy.title);
  await persist({ enabled: true, hour });
  return true;
}

/**
 * Re-arms the reminder for tomorrow after a training log.
 *
 * Decision 2: nothing is sent on a day already logged. A daily trigger
 * would otherwise fire this evening at a child who has already trained,
 * which is the exact nag this design exists to avoid. Rescheduling moves
 * the next occurrence past today.
 *
 * A no-op when the reminder is off, so callers can fire it unconditionally.
 */
export async function skipRemainderOfToday(copy: {
  title: string;
  body: string;
}): Promise<void> {
  const { enabled, hour } = await getReminderSettings();
  if (!enabled) return;
  const now = new Date();
  if (now.getHours() >= hour) return; // today's has already passed
  await cancelAll();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hour, 0, 0, 0);
  await Notifications.scheduleNotificationAsync({
    content: { title: copy.title, body: copy.body, sound: false },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: tomorrow,
    },
  });
  // The one-off above covers tomorrow; the repeating daily trigger is
  // restored the next time the app opens (see AppShell) so the schedule
  // does not decay into a single future notification.
}

/**
 * Restores the repeating daily schedule.
 *
 * Called on app open. Idempotent by way of `cancelAll`, and the reason
 * `skipRemainderOfToday`'s one-off does not permanently replace the daily
 * trigger.
 */
export async function rearmReminder(copy: {
  title: string;
  body: string;
}): Promise<void> {
  const { enabled, hour } = await getReminderSettings();
  if (!enabled) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    // Revoked in OS settings since it was turned on. Reflect reality
    // rather than leaving a switch that claims to be on.
    await persist({ enabled: false, hour });
    return;
  }
  await schedule(hour, copy.body, copy.title);
}
