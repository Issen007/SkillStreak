import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { TextField } from '../components/TextField';
import { Toast } from '../components/Toast';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { clearSessionToken } from '../api/authStorage';
import {
  cancelErasure,
  confirmContactChange,
  getErasureStatus,
  getProfile,
  getTeamDashboard,
  getTeammates,
  requestContactChange,
  requestErasure,
  updateProfile,
} from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import type { ErasureStatusResponse, PlayerProfileResponse, TeammateEntry } from '../api/types';
import { AVATAR_CATALOG } from '../onboarding/avatarCatalog';
import { Avatar } from '../components/Avatar';
import { ErasureRequestScreen } from './erasure/ErasureRequestScreen';
import { ErasureSuccessorScreen } from './erasure/ErasureSuccessorScreen';
import { ErasureConfirmSheet } from './erasure/ErasureConfirmSheet';
import { ErasureCheckEmailScreen } from './erasure/ErasureCheckEmailScreen';
import { ErasureStatusCard } from './erasure/ErasureStatusCard';
import { PtRelationshipsScreen } from './PtRelationshipsScreen';
import { BugReportScreen } from './bugReport/BugReportScreen';
import { BugReportSentScreen } from './bugReport/BugReportSentScreen';

interface ProfileScreenProps {
  screenName: string;
  onBack: () => void;
  /** Same "clear the stored token, then let the caller navigate away"
   * split HomeScreen already uses for a stale/invalidated session
   * (`onSessionInvalid`) — a deliberate logout ends up in the exact same
   * place (onboarding, no session), so it reuses that same callback. */
  onLogout: () => void;
  /** Fas 4.2 (docs/design/phase4.2-account-erasure-flows.md) — E2 needs
   * `GET /teams/:teamId/dashboard` (`viewerIsCaptain`) and
   * `GET /teams/:teamId/teammates` (the successor picker's data), the same
   * two calls K1/K4 already make. Flagged by the flow doc: this screen
   * previously only received `screenName`. */
  teamId: string;
  /** Own player id, needed to exclude the requester's own row from the
   * successor picker (E3) and from the "other players on the team" count
   * that decides E2's captain-gate variant. */
  playerId: string;
}

type ProfileView =
  | 'view'
  | 'editName'
  | 'editAvatar'
  | 'requestChange'
  | 'confirmChange'
  | 'erasureRequest'
  | 'erasureSuccessor'
  | 'erasureCheckEmail'
  // Screens BR2/BR3 — docs/design/phase7-admin-console-flows.md §9. Two
  // more values in this union rather than a new screen container, which
  // is the same call Fas 4.2's three erasure steps made.
  | 'bugReport'
  | 'bugReportSent';

/** Fas 4.1 — docs/adr/0012-profile-page-and-contact-email-change.md.
 * Reached by tapping the avatar circle in `AppHeader`. Own local
 * step-state (not a navigation library), same "not a navigation library"
 * posture as every other multi-step screen in this app. Birth year is
 * shown, never editable (decision 2 — a self-verification-age bypass
 * risk) — there is no input for it anywhere in this file. */
export function ProfileScreen({ screenName, onBack, onLogout, teamId, playerId }: ProfileScreenProps) {
  const { t } = useTranslation('home');
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

  // --- Fas 4.2 — account erasure (docs/adr/0013, docs/design/
  // phase4.2-account-erasure-flows.md) ---------------------------------

  // E1/E6 — backs whether the entry link or the persistent status card
  // shows on Profile's `view` step (Judgment call 8: never both at once).
  const [erasureStatus, setErasureStatus] = useState<ErasureStatusResponse>({ status: 'none' });

  // E2 — the captain-gate variant's team info, fetched fresh whenever E2
  // is opened (not cached elsewhere in this screen).
  const [erasureTeamInfoLoading, setErasureTeamInfoLoading] = useState(false);
  const [erasureTeamInfoError, setErasureTeamInfoError] = useState<string | null>(null);
  const [erasureViewerIsCaptain, setErasureViewerIsCaptain] = useState(false);
  const [erasureTeammateCount, setErasureTeammateCount] = useState(0);

  // The successor committed on E3, shown on E2/E4 — naming one doesn't
  // "use it up" until E4's request is actually submitted (ADR Decision 4).
  const [erasureSuccessorId, setErasureSuccessorId] = useState<string | null>(null);
  const [erasureSuccessorName, setErasureSuccessorName] = useState<string | null>(null);
  const [erasureSuccessorAvatarId, setErasureSuccessorAvatarId] = useState<string | null>(null);

  // E3 — the successor picker, refetched fresh on every entry (K4's own
  // reasoning: staleness here would mean picking from a stale roster).
  const [e3Teammates, setE3Teammates] = useState<TeammateEntry[]>([]);
  const [e3Loading, setE3Loading] = useState(false);
  const [e3Error, setE3Error] = useState<string | null>(null);
  const [e3Selection, setE3Selection] = useState<TeammateEntry | null>(null);

  // E4 — the confirm sheet, a Modal overlay on top of E2.
  const [erasureSheetVisible, setErasureSheetVisible] = useState(false);
  const [erasureSubmitting, setErasureSubmitting] = useState(false);
  const [erasureSheetError, setErasureSheetError] = useState<string | null>(null);

  // E6 — the status card's own cancel action.
  const [erasureCancelling, setErasureCancelling] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      // Fetched alongside getProfile() every time this screen loads or is
      // returned to (Promise.all, not a second round-trip) — this is what
      // decides whether E1 or E6 renders, per the flow doc.
      const [profileResponse, statusResponse] = await Promise.all([
        getProfile(),
        getErasureStatus(),
      ]);
      setProfile(profileResponse);
      setErasureStatus(statusResponse);
      setLoadError(null);
    } catch {
      setLoadError(t('profileScreen.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setToastMessage(t('profileScreen.savedToast'));
    } catch {
      setToastDurationMs(2000);
      setToastMessage(t('shared.genericErrorTryAgain'));
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
      setToastMessage(t('profileScreen.savedToast'));
    } catch {
      setToastDurationMs(2000);
      setToastMessage(t('shared.genericErrorTryAgain'));
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
        setContactError(t('profileScreen.contactChangeRateLimited'));
      } else {
        setContactError(t('profileScreen.contactChangeGenericError'));
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
        t('profileScreen.contactChangeConfirmedToast', { hours: appliesAtHours }),
      );
      void fetchProfile();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_or_expired_contact_change_code') {
        setCodeError(t('profileScreen.codeInvalid'));
      } else {
        setCodeError(t('profileScreen.codeGenericError'));
      }
    } finally {
      setCodeSubmitting(false);
    }
  };

  // --- Fas 4.2 — account erasure handlers -------------------------------

  const fetchErasureTeamInfo = useCallback(async () => {
    setErasureTeamInfoLoading(true);
    setErasureTeamInfoError(null);
    try {
      const [dashboard, teammatesResponse] = await Promise.all([
        getTeamDashboard(teamId),
        getTeammates(teamId),
      ]);
      setErasureViewerIsCaptain(dashboard.viewerIsCaptain);
      setErasureTeammateCount(
        teammatesResponse.teammates.filter((teammate) => teammate.playerId !== playerId).length,
      );
    } catch {
      setErasureTeamInfoError(t('profileScreen.erasureTeamInfoError'));
    } finally {
      setErasureTeamInfoLoading(false);
    }
  }, [teamId, playerId, t]);

  const handleOpenErasureRequest = () => {
    setErasureSuccessorId(null);
    setErasureSuccessorName(null);
    setErasureSuccessorAvatarId(null);
    setView('erasureRequest');
    void fetchErasureTeamInfo();
  };

  const fetchE3Teammates = useCallback(
    async (preferredSuccessorId: string | null) => {
      setE3Loading(true);
      setE3Error(null);
      try {
        const response = await getTeammates(teamId);
        // E3 never shows the requester's own row (Judgment call 4).
        const others = response.teammates.filter((teammate) => teammate.playerId !== playerId);
        setE3Teammates(others);
        setE3Selection(others.find((teammate) => teammate.playerId === preferredSuccessorId) ?? null);
      } catch {
        setE3Error(t('profileScreen.erasureTeammatesError'));
      } finally {
        setE3Loading(false);
      }
    },
    [teamId, playerId, t],
  );

  const handleOpenSuccessorPicker = () => {
    setView('erasureSuccessor');
    void fetchE3Teammates(erasureSuccessorId);
  };

  const handleDoneSuccessorPicker = () => {
    if (!e3Selection) return;
    setErasureSuccessorId(e3Selection.playerId);
    setErasureSuccessorName(e3Selection.screenName);
    setErasureSuccessorAvatarId(e3Selection.avatarId);
    setView('erasureRequest');
  };

  const handleCancelSuccessorPicker = () => {
    setView('erasureRequest');
  };

  const handleConfirmErasure = async () => {
    setErasureSubmitting(true);
    setErasureSheetError(null);
    try {
      await requestErasure({ successorPlayerId: erasureSuccessorId ?? undefined });
      setErasureSubmitting(false);
      setErasureSheetVisible(false);
      setErasureStatus({ status: 'requested' });
      setView('erasureCheckEmail');
    } catch (err) {
      setErasureSubmitting(false);
      if (err instanceof ApiError) {
        if (err.code === 'erasure_blocked_pending_contact_change') {
          setErasureSheetVisible(false);
          setView('view');
          setToastDurationMs(5000);
          setToastMessage(t('profileScreen.erasureBlockedPendingContactChange'));
          return;
        }
        if (err.code === 'erasure_rate_limited') {
          setErasureSheetVisible(false);
          setToastDurationMs(3000);
          setToastMessage(t('profileScreen.erasureRateLimited'));
          return;
        }
        if (err.code === 'erasure_successor_invalid') {
          setErasureSheetVisible(false);
          setToastDurationMs(3000);
          setToastMessage(t('profileScreen.erasureSuccessorInvalid'));
          setErasureSuccessorId(null);
          setErasureSuccessorName(null);
          setErasureSuccessorAvatarId(null);
          setView('erasureSuccessor');
          void fetchE3Teammates(null);
          return;
        }
        // erasure_successor_required/erasure_successor_not_allowed: E2's
        // captain-gate variant was decided once, on mount, from a
        // dashboard/teammates snapshot — if the requester's own captaincy
        // or teammate count changed in the time between opening E2 and
        // tapping through E3/E4 (e.g. another captain handed captaincy to
        // this player, or the team's last other member just left), that
        // snapshot is now stale and the whole request needs re-deciding
        // from scratch, not just cleared successor state like the case
        // above. erasure_already_active: a request from elsewhere (another
        // device, a retried tap) already exists — the status card is the
        // source of truth now, not this sheet.
        if (
          err.code === 'erasure_successor_required' ||
          err.code === 'erasure_successor_not_allowed' ||
          err.code === 'erasure_already_active'
        ) {
          setErasureSheetVisible(false);
          setView('view');
          setToastDurationMs(4000);
          setToastMessage(t('profileScreen.erasureStaleState'));
          void refreshErasureStatus();
          return;
        }
      }
      // Generic/5xx — sheet stays open, inline error, same fallback idiom
      // as everywhere else in this app.
      setErasureSheetError(t('shared.genericErrorTryAgain'));
    }
  };

  // Best-effort — surfaces the true current state rather than leaving a
  // stale local assumption on screen; silently no-ops if this also fails.
  const refreshErasureStatus = async () => {
    try {
      const refreshed = await getErasureStatus();
      setErasureStatus(refreshed);
    } catch {
      // Leave the card/banner as it was.
    }
  };

  const handleCancelErasureRequest = async () => {
    setErasureCancelling(true);
    try {
      await cancelErasure();
      setErasureStatus({ status: 'none' });
      setErasureSuccessorId(null);
      setErasureSuccessorName(null);
      setErasureSuccessorAvatarId(null);
      setToastDurationMs(3000);
      setToastMessage(t('profileScreen.erasureCancelledToast'));
    } catch {
      setToastDurationMs(3000);
      setToastMessage(t('profileScreen.erasureCancelError'));
      await refreshErasureStatus();
    } finally {
      setErasureCancelling(false);
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
        <Text style={styles.errorText}>{loadError ?? t('shared.genericError')}</Text>
        <Text style={styles.retryText} onPress={() => void fetchProfile()}>
          {t('shared.retry')}
        </Text>
      </View>
    );
  }

  if (view === 'editName') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('profileScreen.editName.heading')}</Text>
        <Text style={styles.sub}>{t('profileScreen.editName.sub')}</Text>
        <TextField
          value={nameInput}
          onChangeText={setNameInput}
          placeholder={t('profileScreen.editName.placeholder')}
          autoCapitalize="words"
        />
        <View style={styles.spacer} />
        <PrimaryButton
          label={t('shared.save')}
          onPress={() => void handleSaveName()}
          loading={nameSaving}
        />
        <SecondaryLink label={t('shared.cancel')} onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'editAvatar') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('profileScreen.editAvatar.heading')}</Text>
        <Text style={styles.sub}>{t('profileScreen.editAvatar.sub')}</Text>
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
                <Avatar avatarId={option.avatarId} size={40} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.spacer} />
        <PrimaryButton
          label={t('shared.save')}
          onPress={() => void handleSaveAvatar()}
          disabled={!avatarSelection || avatarSelection === profile.avatarId}
          loading={avatarSaving}
        />
        <SecondaryLink label={t('shared.cancel')} onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'requestChange') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('profileScreen.requestChange.heading')}</Text>
        <Text style={styles.sub}>{t('profileScreen.requestChange.sub')}</Text>
        <TextField
          value={contactInput}
          onChangeText={(text) => {
            setContactInput(text);
            if (contactError) setContactError(null);
          }}
          placeholder={t('profileScreen.requestChange.placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          errorText={contactError ?? undefined}
        />
        <View style={styles.spacer} />
        <PrimaryButton
          label={t('profileScreen.requestChange.submit')}
          onPress={() => void handleRequestChange()}
          disabled={contactInput.trim().length === 0}
          loading={contactSubmitting}
        />
        <SecondaryLink label={t('shared.cancel')} onPress={() => setView('view')} />
      </ScrollView>
    );
  }

  if (view === 'confirmChange') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.icon}>📩</Text>
        <Text style={styles.heading}>{t('profileScreen.confirmChange.heading')}</Text>
        <Text style={styles.sub}>{t('profileScreen.confirmChange.sub')}</Text>
        <TextField
          value={codeInput}
          onChangeText={(text) => {
            setCodeInput(text);
            if (codeError) setCodeError(null);
          }}
          placeholder={t('profileScreen.confirmChange.placeholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          errorText={codeError ?? undefined}
        />
        <View style={styles.spacer} />
        <PrimaryButton
          label={t('profileScreen.confirmChange.submit')}
          onPress={() => void handleConfirmChange()}
          disabled={codeInput.trim().length === 0}
          loading={codeSubmitting}
        />
        <SecondaryLink
          label={t('profileScreen.confirmChange.resend')}
          onPress={() => setView('requestChange')}
        />
      </ScrollView>
    );
  }

  // Screen E2 — docs/design/phase4.2-account-erasure-flows.md. E4's confirm
  // sheet is rendered as a Modal overlay on top of this same view.
  if (view === 'erasureRequest') {
    return (
      <View style={styles.container}>
        <ErasureRequestScreen
          loading={erasureTeamInfoLoading}
          errorText={erasureTeamInfoError}
          onRetry={() => void fetchErasureTeamInfo()}
          viewerIsCaptain={erasureViewerIsCaptain}
          teammateCount={erasureTeammateCount}
          successorScreenName={erasureSuccessorName}
          successorAvatarId={erasureSuccessorAvatarId}
          onChooseSuccessor={handleOpenSuccessorPicker}
          onSubmit={() => {
            setErasureSheetError(null);
            setErasureSheetVisible(true);
          }}
          onCancel={() => setView('view')}
        />
        <ErasureConfirmSheet
          visible={erasureSheetVisible}
          successorScreenName={erasureSuccessorName}
          loading={erasureSubmitting}
          errorText={erasureSheetError}
          onConfirm={() => void handleConfirmErasure()}
          onClose={() => {
            if (!erasureSubmitting) setErasureSheetVisible(false);
          }}
        />
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

  // Screen E3 — successor picker, E2 variant A only.
  if (view === 'erasureSuccessor') {
    return (
      <View style={styles.container}>
        <ErasureSuccessorScreen
          loading={e3Loading}
          errorText={e3Error}
          onRetry={() => void fetchE3Teammates(erasureSuccessorId)}
          teammates={e3Teammates}
          selectedPlayerId={e3Selection?.playerId ?? null}
          onSelect={setE3Selection}
          onDone={handleDoneSuccessorPicker}
          onCancel={handleCancelSuccessorPicker}
        />
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

  // Screen E5 — shown once after a `201` from E4.
  if (view === 'erasureCheckEmail') {
    return <ErasureCheckEmailScreen onDone={() => setView('view')} />;
  }

  // Screen BR2. The toast host is repeated here for the same reason the
  // erasure branches repeat it: each branch returns its own tree, so the
  // one in the main view below is not mounted while this is showing.
  if (view === 'bugReport') {
    return (
      <View style={styles.container}>
        <BugReportScreen
          locale={profile.locale}
          onCancel={() => setView('view')}
          onSent={() => setView('bugReportSent')}
          onToast={(message) => {
            setToastDurationMs(4000);
            setToastMessage(message);
          }}
        />
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

  // Screen BR3.
  if (view === 'bugReportSent') {
    return <BugReportSentScreen onDone={() => setView('view')} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('profileScreen.view.heading')}</Text>
        <Text style={styles.greeting}>{screenName}</Text>

        {erasureStatus.status !== 'none' ? (
          <ErasureStatusCard
            status={erasureStatus.status}
            scheduledFor={erasureStatus.scheduledFor}
            successorScreenName={erasureStatus.successorScreenName}
            onCancel={() => void handleCancelErasureRequest()}
            cancelling={erasureCancelling}
          />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t('profileScreen.view.avatarLabel')}</Text>
          <Avatar avatarId={profile.avatarId} size={48} />
          <SecondaryLink
            label={t('shared.edit')}
            onPress={() => {
              setAvatarSelection(profile.avatarId);
              setView('editAvatar');
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t('profileScreen.view.nameLabel')}</Text>
          <Text style={styles.fieldValue}>{profile.realName ?? t('profileScreen.view.nameNotSet')}</Text>
          <SecondaryLink
            label={profile.realName ? t('shared.edit') : t('profileScreen.view.addName')}
            onPress={() => {
              setNameInput(profile.realName ?? '');
              setView('editName');
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t('profileScreen.view.birthYearLabel')}</Text>
          <Text style={styles.fieldValue}>{profile.birthYear}</Text>
          <Text style={styles.fieldHelper}>{t('profileScreen.view.birthYearHelper')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t('profileScreen.view.contactLabel')}</Text>
          <Text style={styles.fieldValue}>{profile.parentContact}</Text>
          <SecondaryLink
            label={t('profileScreen.view.changeContact')}
            onPress={() => setView('requestChange')}
          />
        </View>

        {/* Screen PL1 (docs/design/phase8-pt-flows.md §7). Renders itself
            as nothing when the player has no PT relationships — this is not
            a concept every child needs to meet, so it appears only once one
            actually exists. */}
        <PtRelationshipsScreen />

        <SecondaryLink label={t('profileScreen.view.back')} onPress={onBack} />
        <SecondaryLink label={t('profileScreen.view.logout')} onPress={() => void handleLogout()} />

        {/* Screen BR1 (docs/design/phase7-admin-console-flows.md §9.1).
            Default muted colour, not `variant="error"` — reporting a bug
            is not destructive. Deliberately here rather than anywhere more
            prominent: the core loop is one tap deep and must not compete
            with a permanent invitation to file "the app is boring".
            Ungated by consent on purpose — a child stuck waiting for a
            parent is exactly who most needs this. */}
        <SecondaryLink
          label={t('profileScreen.view.reportProblem')}
          onPress={() => setView('bugReport')}
        />

        {/* The running build, stamped at image-build time (see
            site/Dockerfile's EXPO_PUBLIC_APP_VERSION). Deliberately the
            last thing on the screen and deliberately plain: nobody is
            looking for it until something is wrong, and then it is the
            first thing worth asking for. A version the app reports about
            itself is also the check that would have caught the 2026-07-30
            incident where production served an internal-test build. */}
        <Text style={styles.versionLine}>{APP_VERSION}</Text>

        {/* Screen E1 — only shown when no erasure request is active
            (Judgment call 8: never alongside E6's status card above). */}
        {erasureStatus.status === 'none' ? (
          <View style={styles.erasureEntrySpacer}>
            <SecondaryLink
              label={t('profileScreen.view.deleteAccount')}
              variant="error"
              onPress={handleOpenErasureRequest}
            />
          </View>
        ) : null}
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

/** "dev" for a local run; CI stamps the release tag or the short SHA. */
const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION ?? 'dev';

const styles = StyleSheet.create({
  versionLine: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 18,
  },
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
  erasureEntrySpacer: {
    marginTop: 10,
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
