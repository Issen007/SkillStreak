import { Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { JOIN_URL_BASE } from '../../api/config';

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
 * The link opens the marketing site's onboarding widget with the invite
 * code pre-filled (see site/index.html's ?code= support) — there's no
 * real App Store/Play Store listing or working deep-link scheme for this
 * prototype yet (docs/BACKLOG.md), so a web link a friend can open
 * regardless of whether they have the app is the only thing that's
 * actually usable right now. */
export function InviteFriendSheet({
  visible,
  inviteCode,
  teamName,
  onClose,
  onCopied,
}: InviteFriendSheetProps) {
  const joinUrl = `${JOIN_URL_BASE}/?code=${encodeURIComponent(inviteCode)}#demo`;
  const message = `Gå med i ${teamName} på SkillStreak! Använd lagkoden ${inviteCode} eller klicka på länken: ${joinUrl}`;

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
          Låt dem skanna koden, eller dela länken — de fyller bara i sitt
          eget smeknamn, laget är redan ifyllt.
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
