import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../avatarCatalog';

interface O3NameAvatarProps {
  initialScreenName: string;
  initialAvatarId: string | null;
  /** Set when arriving here after a 409 screen_name_taken_in_team from O5. */
  externalError?: string | null;
  /** True when arriving here after the 409 case — pre-focuses the name
   * field per the flow doc. */
  focusNameOnMount?: boolean;
  onNext: (screenName: string, avatarId: string) => void;
}

export function O3NameAvatar({
  initialScreenName,
  initialAvatarId,
  externalError,
  focusNameOnMount,
  onNext,
}: O3NameAvatarProps) {
  const [screenName, setScreenName] = useState(initialScreenName);
  const [avatarId, setAvatarId] = useState<string | null>(initialAvatarId);
  const [error, setError] = useState<string | null>(externalError ?? null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (focusNameOnMount) {
      // Give the screen a beat to mount before focusing.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focusNameOnMount]);

  const canProceed = screenName.trim().length > 0 && avatarId !== null;

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>Välj ditt spelarnamn</Text>
      <Text style={styles.sub}>
        Det här är namnet ditt lag ser — inte ditt riktiga namn om du inte
        vill.
      </Text>

      <TextField
        ref={inputRef}
        label="Spelarnamn"
        value={screenName}
        onChangeText={(text) => {
          setScreenName(text);
          if (error) setError(null);
        }}
        placeholder="T.ex. FloorballStar15"
        autoCorrect={false}
        autoComplete="off"
        errorText={error ?? undefined}
      />

      <Text style={styles.gridLabel}>Välj en avatar</Text>
      <View style={styles.grid}>
        {AVATAR_CATALOG.map((option) => {
          const selected = option.avatarId === avatarId;
          return (
            <Pressable
              key={option.avatarId}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setAvatarId(option.avatarId)}
              style={[styles.avatarCell, selected && styles.avatarCellSelected]}
            >
              <Text style={styles.avatarEmoji}>{option.emoji}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.helper}>Ingen bild behövs — välj en figur du gillar.</Text>

      <View style={styles.spacer} />

      <PrimaryButton
        label="Nästa"
        disabled={!canProceed}
        onPress={() => {
          if (canProceed && avatarId) {
            onNext(screenName.trim(), avatarId);
          }
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 8 },
  spacer: { height: 16 },
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
  gridLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  avatarCell: {
    width: '22.5%',
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCellSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  avatarEmoji: {
    fontSize: 26,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
