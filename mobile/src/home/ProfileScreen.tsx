import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { TextField } from '../components/TextField';
import { Toast } from '../components/Toast';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { clearSessionToken } from '../api/authStorage';
import {
  confirmContactChange,
  getProfile,
  requestContactChange,
  updateProfile,
} from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import type { PlayerProfileResponse } from '../api/types';
import { AVATAR_CATALOG } from '../onboarding/avatarCatalog';

interface ProfileScreenProps {
  screenName: string;
  onBack: () => void;
  /** Same "clear the stored token, then let the caller navigate away"
   * split HomeScreen already uses for a stale/invalidated session
   * (`onSessionInvalid`) — a deliberate logout ends up in the exact same
   * place (onboarding, no session), so it reuses that same callback. */
  onLogout: () => void;
}

type ProfileView = 'view' | 'editName' | 'editAvatar' | 'requestChange' | 'confirmChange';

/** Fas 4.1 — docs/adr/0012-profile-page-and-contact-email-change.md.
 * Reached by tapping the avatar circle in `AppHeader`. Own local
 * step-state (not a navigation library), same "not a navigation library"
 * posture as every other multi-step screen in this app. Birth year is
 * shown, never editable (decision 2 — a self-verification-age bypass
 * risk) — there is no input for it anywhere in this file. */
export function ProfileScreen({ screenName, onBack, onLogout }: ProfileScreenProps) {
  const [profile, setProfile] = useState<PlayerProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastDurationMs, setToastDurationMs] = useState(2000);

  const [view, setView] = useState<ProfileView>('view');

  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  const [avatarSelection, setAvatarSelection] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);

  const [contactInput, setContactInput] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSubmitting, setContactSubmitting] = useState(false);

  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSubmitting, setCodeSubmitting] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await getProfile();
      setProfile(response);
      setLoadError(null);
    } catch {
      setLoadError('Kunde inte hämta din profil. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleSaveName = async () => {
    setNameSaving(true);
    try {
      const trimmed = nameInput.trim();
      await updateProfile({ realName: trimmed.length > 0 ? trimmed : null });
      setProfile((prev) => (prev ? { ...prev, realName: trimmed.length > 0 ? trimmed : null } : prev));
      setView('view');
      setToastDurationMs(2000);
      setToastMessage('Sparat!');
    } catch {
      setToastDurationMs(2000);
      setToastMessage('Något gick fel. Testa igen.');
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveAvatar = async () => {
    if (!avatarSelection) return;
    setAvatarSaving(true);
    try {
      await updateProfile({ avatarId: avatarSelection });
      setProfile((prev) => (prev ? { ...prev, avatarId: avatarSelection } : prev));
      setView('view');
      setToastDurationMs(2000);
      setToastMessage('Sparat!');
    } catch {
      setToastDurationMs(2000);
      setToastMessage('Något gick fel. Testa igen.');
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleRequestChange = async () => {
    const trimmed = contactInput.trim();
    if (!trimmed) return;
    setContactSubmitting(true);
    setContactError(null);
    try {
      await requestContactChange({ newContact: trimmed });
      setView('confirmChange');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'contact_change_rate_limited') {
        setContactError('Du har redan bett om en ändring nyligen — vänta lite innan du försöker igen.');
      } else {
        setContactError('Något gick fel. Kolla uppgiften och testa igen.');
      }
    } finally {
      setContactSubmitting(false);
    }
  };

  const handleConfirmChange = async () => {
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    setCodeSubmitting(true);
    setCodeError(null);
    try {
      const result = await confirmContactChange({ code: trimmed });
      setView('view');
      setCodeInput('');
      setContactInput('');
      // security-reviewer finding, 2026-07-28 (ADR-0012 addendum): the
      // change no longer applies instantly — it's a 24h grace period, and
      // the old address got a cancel link. Copy here must not imply it's
      // done already, or a real account owner would have no reason to
      // check that old inbox.
      const appliesAtHours = Math.max(
        1,
        Math.round((new Date(result.appliesAt).getTime() - Date.now()) / 3_600_000),
      );
      setToastDurationMs(5000);
      setToastMessage(
        `Bekräftat! Träder i kraft om ca ${appliesAtHours} tim. Den gamla adressen kan avbryta via mejlet vi skickat dit.`,
      );
      void fetchProfile();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_or_expired_contact_change_code') {
        setCodeError('Den koden fungerar inte längre. Kolla att du skrev rätt, eller be om en ny.');
      } else {
        setCodeError('Något gick fel. Kolla din uppkoppling och testa igen.');
      }
    } finally {
      setCodeSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await clearSessionToken();
    onLogout();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchProfile()}>
          Försök igen
        </Text>
      </View>
    );
  }

  if (view === 'editName') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Ditt namn</Text>
        <Text style={styles.sub}>
          Frivilligt — visas aldrig för andra i laget, bara du ser det här.
        </Text>
        <TextField
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="För- och efternamn"
          autoCapitalize="words"
        />
        <View style={styles.spacer} />
        <PrimaryButton label="Spara" onPress={() => void handleSaveName()} loading={nameSaving} />
        <SecondaryLink label="Avbryt" onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'editAvatar') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Välj avatar</Text>
        <Text style={styles.sub}>Ingen bild behövs — välj en figur du gillar.</Text>
        <View style={styles.avatarGrid}>
          {AVATAR_CATALOG.map((option) => {
            const selected = option.avatarId === avatarSelection;
            return (
              <Pressable
                key={option.avatarId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setAvatarSelection(option.avatarId)}
                style={[styles.avatarCell, selected && styles.avatarCellSelected]}
              >
                <Text style={styles.avatarCellEmoji}>{option.emoji}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.spacer} />
        <PrimaryButton
          label="Spara"
          onPress={() => void handleSaveAvatar()}
          disabled={!avatarSelection || avatarSelection === profile.avatarId}
          loading={avatarSaving}
        />
        <SecondaryLink label="Avbryt" onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'requestChange') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Byt kontaktadress</Text>
        <Text style={styles.sub}>
          Ange den nya adressen. Vi skickar en kod dit för att bekräfta, och en
          notis till den gamla adressen om att en ändring är på gång.
        </Text>
        <TextField
          value={contactInput}
          onChangeText={(text) => {
            setContactInput(text);
            if (contactError) setContactError(null);
          }}
          placeholder="Ny e-postadress eller telefonnummer"
          autoCapitalize="none"
          autoCorrect={false}
          errorText={contactError ?? undefined}
        />
        <View style={styles.spacer} />
        <PrimaryButton
          label="Skicka kod"
          onPress={() => void handleRequestChange()}
          disabled={contactInput.trim().length === 0}
          loading={contactSubmitting}
        />
        <SecondaryLink label="Avbryt" onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'confirmChange') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.icon}>📩</Text>
        <Text style={styles.heading}>Kolla inkorgen</Text>
        <Text style={styles.sub}>
          Vi har skickat en kod till den nya adressen. Ange den nedan för att
          bekräfta bytet.
        </Text>
        <TextField
          value={codeInput}
          onChangeText={(text) => {
            setCodeInput(text);
            if (codeError) setCodeError(null);
          }}
          placeholder="T.ex. H4K7QWXP"
          autoCapitalize="characters"
          autoCorrect={false}
          errorText={codeError ?? undefined}
        />
        <View style={styles.spacer} />
        <PrimaryButton
          label="Bekräfta"
          onPress={() => void handleConfirmChange()}
          disabled={codeInput.trim().length === 0}
          loading={codeSubmitting}
        />
        <SecondaryLink label="Fick du ingen kod? Försök igen" onPress={() => setView('requestChange')} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Din profil</Text>
        <Text style={styles.greeting}>{screenName}</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Avatar</Text>
          <Text style={styles.avatarPreviewEmoji}>
            {AVATAR_CATALOG.find((a) => a.avatarId === profile.avatarId)?.emoji ?? '🙂'}
          </Text>
          <SecondaryLink
            label="Ändra"
            onPress={() => {
              setAvatarSelection(profile.avatarId);
              setView('editAvatar');
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Namn</Text>
          <Text style={styles.fieldValue}>{profile.realName ?? 'Inte angivet'}</Text>
          <SecondaryLink
            label={profile.realName ? 'Ändra' : 'Lägg till'}
            onPress={() => {
              setNameInput(profile.realName ?? '');
              setView('editName');
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Födelseår</Text>
          <Text style={styles.fieldValue}>{profile.birthYear}</Text>
          <Text style={styles.fieldHelper}>
            Går inte att ändra själv — hör av dig till lagets tränare om det
            behöver rättas.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Kontaktadress</Text>
          <Text style={styles.fieldValue}>{profile.parentContact}</Text>
          <SecondaryLink label="Byt" onPress={() => setView('requestChange')} />
        </View>

        <SecondaryLink label="Tillbaka" onPress={onBack} />
        <SecondaryLink label="Logga ut" onPress={() => void handleLogout()} />
      </ScrollView>

      {toastMessage ? (
        <Toast
          message={toastMessage}
          durationMs={toastDurationMs}
          onDismiss={() => setToastMessage(null)}
        />
      ) : null}
    </View>
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
    paddingBottom: 32,
    gap: 14,
  },
  spacer: {
    height: 20,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  greeting: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: -8,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  icon: {
    fontSize: 32,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  fieldLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldValue: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
  },
  fieldHelper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  avatarPreviewEmoji: {
    fontSize: 32,
  },
  avatarGrid: {
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
  avatarCellEmoji: {
    fontSize: 26,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
