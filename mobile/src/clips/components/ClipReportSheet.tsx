import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ClipReportReason } from '../../api/types';

// Order is deliberate, video-specific concerns first (per the flow doc's
// judgment call 7) — `appears_without_consent` is this feature's single
// most serious category and shouldn't be buried at the bottom of an
// otherwise-generic list the way chat puts bullying first.
const REASON_VALUES: ClipReportReason[] = [
  'appears_without_consent',
  'bullying',
  'inappropriate_content',
  'not_training_related',
  'other',
];

function reasonLabelKey(
  value: ClipReportReason,
):
  | 'v9.reasonAppearsWithoutConsent'
  | 'v9.reasonBullying'
  | 'v9.reasonInappropriateContent'
  | 'v9.reasonNotTrainingRelated'
  | 'v9.reasonOther' {
  switch (value) {
    case 'appears_without_consent':
      return 'v9.reasonAppearsWithoutConsent';
    case 'bullying':
      return 'v9.reasonBullying';
    case 'inappropriate_content':
      return 'v9.reasonInappropriateContent';
    case 'not_training_related':
      return 'v9.reasonNotTrainingRelated';
    default:
      return 'v9.reasonOther';
  }
}

const NOTE_MAX_LENGTH = 140;

interface ClipReportSheetProps {
  visible: boolean;
  loading: boolean;
  onSubmit: (reason: ClipReportReason, note: string | undefined) => void;
  onClose: () => void;
}

/** Screen V9 — the report-reason bottom sheet, same visual pattern as CH2.
 * Five large, tappable, single-select rows (not a dropdown). */
export function ClipReportSheet({ visible, loading, onSubmit, onClose }: ClipReportSheetProps) {
  const { t } = useTranslation('clips');
  const [reason, setReason] = useState<ClipReportReason | null>(null);
  const [note, setNote] = useState('');

  const handleClose = () => {
    setReason(null);
    setNote('');
    onClose();
  };

  const handleSubmit = () => {
    if (!reason) return;
    onSubmit(reason, note.trim().length > 0 ? note.trim() : undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : handleClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{t('v9.heading')}</Text>

        {REASON_VALUES.map((value) => {
          const selected = value === reason;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setReason(value)}
              style={[styles.reasonRow, selected && styles.reasonRowSelected]}
            >
              <Text style={styles.reasonLabel}>{t(reasonLabelKey(value))}</Text>
            </Pressable>
          );
        })}

        <Text style={styles.noteLabel}>{t('v9.noteLabel')}</Text>
        <TextInput
          value={note}
          onChangeText={(text) => setNote(text.slice(0, NOTE_MAX_LENGTH))}
          placeholder={t('v9.notePlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.noteInput}
        />
        <Text style={styles.noteCounter}>
          {note.length}/{NOTE_MAX_LENGTH}
        </Text>

        <PrimaryButton
          label={t('v9.submit')}
          disabled={!reason}
          loading={loading}
          onPress={handleSubmit}
        />
        <SecondaryLink label={t('v9.cancel')} onPress={handleClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,27,58,0.35)',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
  },
  reasonRow: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  reasonRowSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  reasonLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  noteLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  noteInput: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    minHeight: 50,
  },
  noteCounter: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
});
