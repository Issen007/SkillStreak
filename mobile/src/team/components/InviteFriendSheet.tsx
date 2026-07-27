import { Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { EXPO_GO_URL, JOIN_URL_BASE } from '../../api/config';

interface InviteFriendSheetProps {
  visible: boolean;
  inviteCode: string;
  teamName: string;
  onClose: () => void;
  onCopied: () => void;
}

/** Screen K1's "Bjud in en kompis" — any team member can open this (not
 * captain-gated, same as the dashboard field it reads inviteCode from).
 * One link/QR does double duty for every share channel the request asked
 * for: scanning it IS the QR-code path, and handing the same link to
 * Share.share() covers Messages/Email/WhatsApp/etc. via the OS's own
 * share sheet rather than building a separate flow per channel.
 *
 * Two very different targets depending on EXPO_GO_URL (added 2026-07-27):
 * - Set (a live `npx expo start` dev server is running): the QR/link opens
 *   Expo Go directly, so a friend can actually run the real app, not just
 *   its web export. There's no real deep-link handling in this app yet
 *   (docs/BACKLOG.md), so exp:// launch can't carry the invite code
 *   through automatically — the friend still types the lagkod themselves
 *   once the app opens, same as typing it in by hand always required.
 * - Unset (the normal/deployed case, no dev server exists): falls back to
 *   the marketing site's onboarding widget with the code pre-filled (see
 *   site/index.html's ?code= support) — there's no real App Store/Play
 *   Store listing for this prototype yet, so a web link a friend can open
 *   regardless of whether they have the app is what's actually usable. */
export function InviteFriendSheet({
  visible,
  inviteCode,
  teamName,
  onClose,
  onCopied,
}: InviteFriendSheetProps) {
  const usingExpoGo = Boolean(EXPO_GO_URL);
  const joinUrl = usingExpoGo
    ? (EXPO_GO_URL as string)
    : `${JOIN_URL_BASE}/?code=${encodeURIComponent(inviteCode)}#demo`;
  const message = usingExpoGo
    ? `Gå med i ${teamName} på SkillStreak! Öppna länken i Expo Go, skriv sen in lagkoden ${inviteCode} när appen startar: ${joinUrl}`
    : `Gå med i ${teamName} på SkillStreak! Använd lagkoden ${inviteCode} eller klicka på länken: ${joinUrl}`;

  const handleShare = async () => {
    if (Platform.OS === 'web') {
      // React Native's Share API has no react-native-web implementation
      // at all (same "native module, nothing behind it on web" gap this
      // app already hit with expo-secure-store, @react-native-picker/
      // picker, and @react-native-community/datetimepicker) — the Web
      // Share API (navigator.share) is the browser-native equivalent
      // where it exists (most mobile browsers); desktop browsers without
      // it fall back to a clipboard copy instead of doing nothing.
      const nav = globalThis.navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (nav.share) {
        try {
          await nav.share({ title: 'SkillStreak', text: message, url: joinUrl });
        } catch {
          // User cancelled the share sheet — not an error.
        }
        return;
      }
      if (nav.clipboard) {
        await nav.clipboard.writeText(message);
        onCopied();
      }
      return;
    }
    await Share.share({ message });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Bjud in en kompis</Text>
        <Text style={styles.sub}>
          {usingExpoGo
            ? 'Låt dem skanna koden för att öppna appen i Expo Go, sedan skriver de in lagkoden nedan.'
            : 'Låt dem skanna koden, eller dela länken — de fyller bara i sitt eget smeknamn, laget är redan ifyllt.'}
        </Text>

        <View style={styles.qrFrame}>
          <QRCode value={joinUrl} size={180} color={colors.ink} backgroundColor={colors.white} />
        </View>

        <Text style={styles.codeLabel}>Lagkod</Text>
        <Text style={styles.code}>{inviteCode}</Text>

        <PrimaryButton label="Dela inbjudan" onPress={() => void handleShare()} />
        <Pressable onPress={onClose} style={styles.closeLink}>
          <Text style={styles.closeLinkText}>Stäng</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,27,58,0.4)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 12,
    alignItems: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  qrFrame: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    marginTop: 8,
  },
  codeLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  code: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    letterSpacing: 1,
    marginBottom: 8,
  },
  closeLink: {
    padding: 8,
  },
  closeLinkText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
