import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { CLIP_MAX_DURATION_SECONDS, validatePickedAsset } from './clipValidation';
import type { PickedClip } from './PickedClip';

interface V4PickClipProps {
  onPicked: (clip: PickedClip) => void;
  onCancel: () => void;
}

/** Screen V4 — "Välj eller spela in ett klipp." No API call yet — this is
 * the device's native camera/media-picker. A picked/recorded clip is
 * validated client-side (duration/size/format) against the same caps the
 * contract enforces server-side, so an obviously invalid file gets an
 * inline message here rather than a round-trip `400`. */
export function V4PickClip({ onPicked, onCancel }: V4PickClipProps) {
  const { t } = useTranslation('clips');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const validation = await validatePickedAsset(asset);
    if (!validation.ok) {
      setErrorText(
        validation.reason === 'wrong_format'
          ? t('v4.wrongFormat')
          : validation.reason === 'too_long'
            ? t('v4.tooLong', { maxSeconds: CLIP_MAX_DURATION_SECONDS })
            : t('v4.unreadable'),
      );
      return;
    }
    setErrorText(null);
    onPicked(validation.clip);
  };

  const handleRecord = async () => {
    setErrorText(null);
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setErrorText(t('v4.permission'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: CLIP_MAX_DURATION_SECONDS,
      });
      await handleResult(result);
    } catch {
      setErrorText(t('v4.unreadable'));
    } finally {
      setBusy(false);
    }
  };

  const handlePickFromLibrary = async () => {
    setErrorText(null);
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorText(t('v4.permission'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
      });
      await handleResult(result);
    } catch {
      setErrorText(t('v4.unreadable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('v4.heading')}</Text>
      <Text style={styles.sub}>{t('v4.sub', { maxSeconds: CLIP_MAX_DURATION_SECONDS })}</Text>

      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

      <View style={styles.actions}>
        <PrimaryButton label={t('v4.record')} loading={busy} onPress={() => void handleRecord()} />
        <SecondaryButton
          label={t('v4.pickFromLibrary')}
          loading={busy}
          onPress={() => void handlePickFromLibrary()}
        />
      </View>

      <SecondaryLink label={t('v4.cancel')} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 24,
    paddingTop: 64,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textBody,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
  },
  actions: {
    gap: 10,
    marginTop: 10,
  },
});
