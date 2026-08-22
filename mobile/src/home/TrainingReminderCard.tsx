import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  EARLIEST_HOUR,
  getReminderSettings,
  LATEST_HOUR,
  selectableHours,
  setReminderEnabled,
} from '../api/trainingReminder';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

/**
 * ADR-0033's one setting: a daily "time to train" reminder, local to this
 * device.
 *
 * **The hour picker only offers 08:00–20:00**, and that is the decision
 * rather than a default — a reminder for a nine-year-old must not be able
 * to land at bedtime. The bound lives in `trainingReminder.ts`; this just
 * renders what it offers, so there is one place to change it.
 *
 * The switch reports what actually happened. If the OS refuses permission
 * it goes back off and says so, because a toggle that looks on and
 * silently does nothing is worse than an honest failure — and on a child's
 * phone, "I turned it on and it never reminded me" is indistinguishable
 * from the app being broken.
 */
export function TrainingReminderCard({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const { t } = useTranslation('home');
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(17);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await getReminderSettings();
      setEnabled(settings.enabled);
      setHour(settings.hour);
    })();
  }, []);

  const apply = useCallback(
    async (nextEnabled: boolean, nextHour: number) => {
      setBusy(true);
      try {
        const ok = await setReminderEnabled(nextEnabled, nextHour, {
          title: t('trainingReminder.notifTitle'),
          body: t('trainingReminder.notifBody'),
        });
        if (nextEnabled && !ok) {
          setEnabled(false);
          onMessage(t('trainingReminder.denied'));
          return;
        }
        setEnabled(nextEnabled);
        setHour(nextHour);
        onMessage(
          nextEnabled
            ? t('trainingReminder.onToast', { hour: `${nextHour}:00` })
            : t('trainingReminder.offToast'),
        );
      } finally {
        setBusy(false);
      }
    },
    [onMessage, t],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('trainingReminder.heading')}</Text>
      <Text style={styles.body}>{t('trainingReminder.body')}</Text>

      <View style={styles.row}>
        <Text style={styles.toggleLabel}>{t('trainingReminder.toggle')}</Text>
        <Switch
          value={enabled}
          disabled={busy}
          onValueChange={(next) => void apply(next, hour)}
          accessibilityLabel={t('trainingReminder.toggle')}
        />
      </View>

      {enabled ? (
        <View>
          <Text style={styles.timeLabel}>{t('trainingReminder.time')}</Text>
          <View style={styles.hours}>
            {selectableHours().map((candidate) => (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityState={{ selected: candidate === hour }}
                disabled={busy}
                onPress={() => void apply(true, candidate)}
                style={[
                  styles.hour,
                  candidate === hour ? styles.hourActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.hourText,
                    candidate === hour ? styles.hourTextActive : null,
                  ]}
                >
                  {candidate}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* Says the bound out loud rather than leaving the child to
              infer it from a picker that simply stops. */}
          <Text style={styles.bounds}>
            {`${EARLIEST_HOUR}:00–${LATEST_HOUR}:00`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  heading: { fontFamily: fonts.headingBold, fontSize: 16, color: colors.ink },
  body: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
  },
  timeLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hour: {
    minWidth: 44,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 8,
  },
  hourActive: { borderColor: colors.flame, backgroundColor: colors.flame },
  hourText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  hourTextActive: { color: colors.white },
  bounds: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
});
