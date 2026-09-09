import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../api/ApiError';
import { submitImprovementSuggestion } from '../api/endpoints';
import { APP_VERSION } from '../appVersion';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { TextField } from '../components/TextField';
import { asPlayerLocale } from '../i18n/deviceLocale';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

/** The backend column's own width. The input is *capped*, not
 * validated-then-rejected: a nine-year-old typing into a box that quietly
 * stops is a far better experience than one that takes the text and then
 * refuses it. The `too-long` state below exists only for a stale client. */
const BODY_MAX_LENGTH = 500;

interface SuggestIdeaScreenProps {
  onCancel: () => void;
  onSent: () => void;
  /** Toast host lives on TipsScreen; the rate-limited and generic failures
   * are toasts rather than inline errors, matching the bug-report form. */
  onToast: (message: string) => void;
}

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — the child's half.
 *
 * One free-text box and nothing else. Deliberately no category picker, no
 * title field and no "which screen" chips: a bug report needs those
 * because a category alone is still a useful report, while an idea is
 * only ever the sentence the child wrote. Every extra required field here
 * is a reason not to bother.
 *
 * The disclosure block is not decoration. It is the only place a child is
 * told what leaves their phone and who reads it, and it says what is
 * *not* sent as plainly as what is — the same posture as the consent copy
 * elsewhere in this app.
 *
 * **Promises no reply**, on the success screen and here, because there is
 * no reply channel in this design: the operator moves a status and
 * nothing writes back to the child. Copy like "we'll get back to you"
 * would be a promise the system structurally cannot keep.
 */
export function SuggestIdeaScreen({
  onCancel,
  onSent,
  onToast,
}: SuggestIdeaScreenProps) {
  const { t, i18n } = useTranslation('tips');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tooLong, setTooLong] = useState(false);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit() {
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    setTooLong(false);
    try {
      await submitImprovementSuggestion({
        body: trimmed,
        appVersion: APP_VERSION,
        // The language the child is actually reading, which is what the
        // operator needs to know to read the text back.
        locale: asPlayerLocale(i18n.language),
      });
      onSent();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'improvement_suggestion_rate_limited'
      ) {
        // Nothing is cleared — the child can come back tomorrow with the
        // same text still typed, as long as they stay on this screen.
        onToast(t('idea.rateLimited'));
      } else if (error instanceof ApiError && error.status === 400) {
        // Unreachable from this UI thanks to the cap above; handled
        // because a stale client can still hit it.
        setTooLong(true);
      } else {
        onToast(t('idea.genericError'));
      }
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('idea.heading')}</Text>
      <Text style={styles.sub}>{t('idea.sub')}</Text>

      <TextField
        value={body}
        onChangeText={(next) => {
          setBody(next);
          if (tooLong) setTooLong(false);
        }}
        label={t('idea.label')}
        placeholder={t('idea.placeholder')}
        multiline
        maxLength={BODY_MAX_LENGTH}
        editable={!submitting}
        style={styles.textArea}
        errorText={tooLong ? t('idea.tooLong') : undefined}
      />
      <Text style={styles.counter}>
        {t('idea.counter', { used: body.length, max: BODY_MAX_LENGTH })}
      </Text>

      <View style={styles.disclosure}>
        <Text style={styles.disclosureTitle}>💡 {t('idea.disclosureTitle')}</Text>
        <Text style={styles.disclosureBody}>{t('idea.disclosureSent')}</Text>
        <Text style={styles.disclosureBody}>{t('idea.disclosureNotSent')}</Text>
        <Text style={styles.disclosureBody}>{t('idea.disclosureWho')}</Text>
      </View>

      <PrimaryButton
        label={t('idea.submit')}
        onPress={() => void handleSubmit()}
        disabled={!canSubmit}
        loading={submitting}
      />
      {/* No confirmation prompt on cancel — nothing durable was created,
          same posture as the bug-report and erasure flows. */}
      <SecondaryLink label={t('idea.cancel')} onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: 20,
    paddingTop: 40,
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
  textArea: {
    minHeight: 140,
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
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 6,
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
