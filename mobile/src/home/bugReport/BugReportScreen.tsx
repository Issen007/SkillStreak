import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { submitBugReport } from '../../api/endpoints';
import { ApiError } from '../../api/ApiError';
import type {
  BugReportCategory,
  BugReportPlatform,
  BugReportScreen as BugReportScreenId,
  PlayerLocale,
} from '../../api/types';
import { APP_VERSION } from '../../appVersion';

/** §9.2's hard cap. The input is *capped*, not validated-then-rejected —
 * a nine-year-old typing into a box that silently stops is a far better
 * experience than one that accepts text and then refuses it. §9.4's
 * `too-long` state exists only for a stale client and is handled below. */
const DESCRIPTION_MAX_LENGTH = 500;

/** Picker order is the design's order, not the enum's. Both lists are 1:1
 * with the backend's Postgres enums — see the note in api/types.ts. */
const CATEGORIES: readonly BugReportCategory[] = [
  'crash',
  'missing_or_wrong_data',
  'login_issue',
  'upload_failed',
  'other',
];

const SCREENS: readonly BugReportScreenId[] = [
  'home',
  'chat',
  'clips',
  'clip_upload',
  'goal',
  'team',
  'leaderboard',
  'profile',
  'onboarding',
  'other',
];

/** Stamped at image-build time, same source as the version line on the
 * Profile screen itself. 'dev' for a local run. */


function currentPlatform(): BugReportPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/** "iOS 17.5.1" / "Android 14". `Platform.Version` is a string on iOS and
 * the API level as a number on Android, so both are normalised here rather
 * than sent raw — an admin triaging a report should not have to remember
 * that 34 means Android 14.
 *
 * Deliberately NOT the device model. §9.2's disclosure copy promises the
 * child we send "what kind of phone" (iOS/Android) and explicitly *not*
 * "which phone it is" — a model string is an identifier-shaped detail and
 * would make that copy a lie. */
function currentOsVersion(): string | undefined {
  const version = Platform.Version;
  if (version === undefined || version === null) return undefined;
  if (Platform.OS === 'ios') return `iOS ${String(version)}`;
  if (Platform.OS === 'android') return `Android API ${String(version)}`;
  return undefined;
}

interface BugReportScreenProps {
  /** The player's current locale — sent so a report can be read in the
   * language the child actually saw the app in. */
  locale: PlayerLocale;
  onCancel: () => void;
  onSent: () => void;
  /** Toast host lives on ProfileScreen; §9.4's rate-limited and generic
   * failures are toasts, not inline errors. */
  onToast: (message: string) => void;
}

/** Screen BR2 — docs/design/phase7-admin-console-flows.md §9.2.
 *
 * Two required pickers and an optional textarea. Submit stays disabled
 * until both pickers are answered; the description is genuinely optional,
 * because a category alone is still a useful report and demanding writing
 * from a nine-year-old suppresses reports (Decision 7's own reasoning).
 *
 * The disclosure block is not decoration. It is the only place a child is
 * told what leaves their phone, and it says what is *not* sent as
 * plainly as what is — which is the same posture as the consent copy
 * elsewhere in this app. */
export function BugReportScreen({ locale, onCancel, onSent, onToast }: BugReportScreenProps) {
  const { t } = useTranslation('home');
  const [category, setCategory] = useState<BugReportCategory | null>(null);
  const [screen, setScreen] = useState<BugReportScreenId | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tooLong, setTooLong] = useState(false);

  const canSubmit = useMemo(
    () => category !== null && screen !== null && !submitting,
    [category, screen, submitting],
  );

  async function handleSubmit() {
    if (category === null || screen === null || submitting) return;
    setSubmitting(true);
    setTooLong(false);
    const trimmed = description.trim();
    try {
      await submitBugReport({
        category,
        screen,
        // Omitted rather than sent empty: the DTO transforms a blank
        // string to undefined anyway, and an absent field is the honest
        // representation of "the child chose not to write anything".
        description: trimmed.length > 0 ? trimmed : undefined,
        appVersion: APP_VERSION,
        platform: currentPlatform(),
        osVersion: currentOsVersion(),
        locale,
      });
      onSent();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'bug_report_rate_limited') {
        // Nothing is cleared — the child can come back tomorrow with the
        // same text still typed, as long as they stay on this screen.
        onToast(t('bugReport.rateLimited'));
      } else if (error instanceof ApiError && error.status === 400) {
        // Unreachable from this UI thanks to the cap above; handled
        // because a stale client can still hit it.
        setTooLong(true);
      } else {
        onToast(t('shared.genericErrorTryAgain'));
      }
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('bugReport.heading')}</Text>
      <Text style={styles.sub}>{t('bugReport.sub')}</Text>

      <Text style={styles.groupLabel}>{t('bugReport.categoryLabel')}</Text>
      <View
        style={styles.radioGroup}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('bugReport.a11yCategoryGroup')}
      >
        {CATEGORIES.map((value) => {
          const selected = category === value;
          return (
            <Pressable
              key={value}
              style={[styles.radioRow, selected ? styles.radioRowSelected : null]}
              disabled={submitting}
              onPress={() => setCategory(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: submitting }}
              accessibilityLabel={t(`bugReport.categories.${value}`)}
            >
              <View style={[styles.radioDot, selected ? styles.radioDotSelected : null]}>
                {selected ? <View style={styles.radioDotInner} /> : null}
              </View>
              <Text style={styles.radioLabel}>{t(`bugReport.categories.${value}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.groupLabel}>{t('bugReport.screenLabel')}</Text>
      <View
        style={styles.chipWrap}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('bugReport.a11yScreenGroup')}
      >
        {SCREENS.map((value) => {
          const selected = screen === value;
          return (
            <Pressable
              key={value}
              style={[styles.chip, selected ? styles.chipSelected : null]}
              disabled={submitting}
              onPress={() => setScreen(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: submitting }}
            >
              <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                {t(`bugReport.screens.${value}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.groupLabel}>{t('bugReport.descriptionLabel')}</Text>
      <TextField
        value={description}
        onChangeText={(next) => {
          setDescription(next);
          if (tooLong) setTooLong(false);
        }}
        placeholder={t('bugReport.descriptionPlaceholder')}
        multiline
        maxLength={DESCRIPTION_MAX_LENGTH}
        editable={!submitting}
        style={styles.textArea}
        // §9.4's `too-long` state. Uses TextField's own error slot rather
        // than a bespoke line, so it looks like every other field error in
        // the app.
        errorText={tooLong ? t('bugReport.descriptionTooLong') : undefined}
      />
      <Text style={styles.counter}>
        {t('bugReport.descriptionCounter', { count: description.length })}
      </Text>

      <View style={styles.disclosure}>
        <Text style={styles.disclosureTitle}>💡 {t('bugReport.disclosureTitle')}</Text>
        <Text style={styles.disclosureBody}>{t('bugReport.disclosureSent')}</Text>
        <Text style={styles.disclosureBody}>{t('bugReport.disclosureNotSent')}</Text>
        <Text style={styles.disclosureBody}>{t('bugReport.disclosureWho')}</Text>
      </View>

      <PrimaryButton
        label={t('bugReport.submit')}
        onPress={() => void handleSubmit()}
        disabled={!canSubmit}
        loading={submitting}
      />
      {/* No confirmation prompt on cancel — nothing durable was created,
          same posture as the erasure flow's Avbryt. */}
      <SecondaryLink label={t('shared.cancel')} onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 20,
  },
  groupLabel: {
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: 8,
  },
  radioGroup: {
    gap: 8,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  radioRowSelected: {
    borderColor: colors.flame,
  },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDotSelected: {
    borderColor: colors.flame,
  },
  radioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.flame,
  },
  radioLabel: {
    // No numberOfLines: these wrap on purpose. German runs ~2.5x the
    // Swedish on the longest option.
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    // Grows to its content; no fixed width, for the same locale-length
    // reason as the radio rows.
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  chipLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
  },
  chipLabelSelected: {
    fontFamily: fonts.headingBold,
    color: colors.flame,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
  },
  disclosure: {
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.tipBg,
    borderWidth: 1,
    borderColor: colors.tipBorder,
    marginTop: 4,
  },
  disclosureTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 14,
    color: colors.ink,
  },
  disclosureBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 19,
  },
});
