import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

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
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>Sätt lagets mål för veckan</Text>
      <Text style={styles.sub}>Ge det ett kul namn — det här är vad hela laget ser.</Text>

      <TextField
        label="Titel"
        placeholder="T.ex. Zorro-finter-utmaningen"
        value={title}
        onChangeText={setTitle}
        maxLength={140}
      />
      <TextField
        label="Beskrivning"
        placeholder="T.ex. Gör så många zorro-finter ni kan tillsammans innan fredag!"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={styles.multiline}
        maxLength={2000}
      />

      <PrimaryButton
        label="Nästa"
        disabled={title.trim().length === 0}
        onPress={() => onNext(title.trim(), description.trim())}
      />
      <SecondaryLink label="Avbryt" onPress={onCancel} />
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
