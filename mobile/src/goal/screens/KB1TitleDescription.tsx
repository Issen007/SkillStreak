import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface KB1Props {
  initialTitle: string;
  initialDescription: string;
  onNext: (title: string, description: string) => void;
  onCancel: () => void;
}

/** Screen KB1 — first step of the weekly-goal builder. */
export function KB1TitleDescription({
  initialTitle,
  initialDescription,
  onNext,
  onCancel,
}: KB1Props) {
  const { t } = useTranslation('goal');
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>{t('kb1.heading')}</Text>
      <Text style={styles.sub}>{t('kb1.sub')}</Text>

      <TextField
        label={t('kb1.titleLabel')}
        placeholder={t('kb1.titlePlaceholder')}
        value={title}
        onChangeText={setTitle}
        maxLength={140}
      />
      <TextField
        label={t('kb1.descriptionLabel')}
        placeholder={t('kb1.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={styles.multiline}
        maxLength={2000}
      />

      <PrimaryButton
        label={t('kb1.next')}
        disabled={title.trim().length === 0}
        onPress={() => onNext(title.trim(), description.trim())}
      />
      <SecondaryLink label={t('kb1.cancel')} onPress={onCancel} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
