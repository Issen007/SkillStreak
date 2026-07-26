import { useState } from 'react';

import { O1EnterCode } from './screens/O1EnterCode';
import { O1aTeamNotFound } from './screens/O1aTeamNotFound';
import { O1bNameTeam } from './screens/O1bNameTeam';
import { O1cConfirmNewTeam } from './screens/O1cConfirmNewTeam';
import { O2ConfirmTeam } from './screens/O2ConfirmTeam';
import { O3NameAvatar } from './screens/O3NameAvatar';
import { O4BirthYear } from './screens/O4BirthYear';
import { O5ConsentAsk } from './screens/O5ConsentAsk';
import { O6Confirmation } from './screens/O6Confirmation';
import { INITIAL_ONBOARDING_DATA, OnboardingData, OnboardingStep } from './types';
import { createPlayer } from '../api/endpoints';
import { setSessionToken } from '../api/authStorage';
import { ApiError } from '../api/ApiError';

interface OnboardingFlowProps {
  /** Called once the account is created and the session token is stored —
   * parent (AppRoot) switches to the home screen. */
  onComplete: () => void;
}

/** O1-O6 (plus O1a/O1b/O1c, the 2026-07-09 self-service-team-creation
 * branch) per docs/design/phase1-flows.md — a mostly-linear flow with a
 * handful of documented "jump back" recovery paths (404 -> O1a,
 * 409 screen_name_taken_in_team -> O3, 404 invite_code_not_found -> O1,
 * 422 team_name_rejected_by_filter -> O1b, 409
 * invite_code_taken_concurrently -> O1), modeled as a small state machine
 * rather than a stack navigator: there's no deep back-history to preserve
 * beyond "which step am I on" plus the accumulated form data. */
export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>('O1');
  const [data, setData] = useState<OnboardingData>(INITIAL_ONBOARDING_DATA);

  const [o1Error, setO1Error] = useState<string | null>(null);
  const [selectCodeOnO1, setSelectCodeOnO1] = useState(false);
  const [o1bError, setO1bError] = useState<string | null>(null);
  const [focusNameOnO1b, setFocusNameOnO1b] = useState(false);
  const [o3Error, setO3Error] = useState<string | null>(null);
  const [focusNameOnO3, setFocusNameOnO3] = useState(false);
  const [o4Error, setO4Error] = useState<string | null>(null);
  const [o5Loading, setO5Loading] = useState(false);
  const [o5Error, setO5Error] = useState<string | null>(null);

  /** Shared by O5's normal submit and (if ever re-triggered) a retry —
   * kept as one function so every error branch of `POST /players` is
   * handled in exactly one place. */
  const submitPlayer = async (current: OnboardingData) => {
    if (!current.inviteCode || !current.avatarId || current.birthYear === null) {
      // Defensive only — the flow can't reach O5 without these set.
      return;
    }
    setO5Loading(true);
    setO5Error(null);
    try {
      const response = await createPlayer({
        inviteCode: current.inviteCode,
        screenName: current.screenName,
        avatarId: current.avatarId,
        birthYear: current.birthYear,
        parentContact: current.parentContact,
        // Absent entirely for the join path — per the contract, that's
        // what keeps this byte-for-byte the pre-ADR-0009 behavior.
        ...(current.isCreatingTeam && current.teamName
          ? { teamName: current.teamName }
          : {}),
      });
      await setSessionToken(response.sessionToken);
      setData((prev) => ({
        ...prev,
        screenName: response.screenName,
        teamName: response.teamName,
        teamCreated: response.teamCreated,
        isCaptain: response.isCaptain,
      }));
      setStep('O6');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'screen_name_taken_in_team') {
        setO3Error('Det namnet är upptaget i laget — testa ett annat!');
        setFocusNameOnO3(true);
        setStep('O3');
      } else if (err instanceof ApiError && err.code === 'team_name_rejected_by_filter') {
        // Create path only (ADR-0009's response addendum) — non-judgmental
        // copy, same posture as team chat's message_rejected_by_filter.
        // TeamsService.createTeam checks the team name AND the invite code
        // against the same filter and throws this exact code either way
        // (docs/adr/0009's Decision 5/backend implementation) — the client
        // can't tell which field actually failed, so the copy deliberately
        // names both possibilities and points at "Byt kod" rather than
        // blaming the name alone, which would leave a kid whose *code* was
        // the real problem stuck retyping an already-fine name.
        setO1bError(
          'Namnet eller lagkoden innehöll ord som inte funkar här. Skriv om namnet, eller tryck "Byt kod" ovan om det är koden.',
        );
        setFocusNameOnO1b(true);
        setStep('O1b');
      } else if (err instanceof ApiError && err.code === 'invite_code_taken_concurrently') {
        // Extremely rare race (ADR-0009 Decision 8) — the code is now
        // genuinely gone. Input cleared, everything else (screen name,
        // avatar, birth year, parent contact) stays in `data` untouched so
        // the kid doesn't have to redo O3-O5 once a new code resolves.
        setData((prev) => ({
          ...prev,
          inviteCode: '',
          teamId: null,
          isCreatingTeam: false,
        }));
        setO1Error(
          'Åh nej — någon hann skapa ett lag med den koden precis före dig! Testa en annan kod, så ordnar vi resten direkt.',
        );
        setSelectCodeOnO1(false);
        setStep('O1');
      } else if (err instanceof ApiError && err.code === 'invite_code_not_found') {
        // Edge case: the code became invalid between O1 and now (e.g. a
        // coach retired it) — join path only, `teamName` absent.
        setData((prev) => ({ ...prev, teamId: null, teamName: null }));
        setO1Error('Lagkoden fungerar inte längre. Fråga din tränare om en ny kod.');
        setSelectCodeOnO1(false);
        setStep('O1');
      } else if (err instanceof ApiError && err.status === 400) {
        // A raw class-validator failure (AppExceptionFilter's generic
        // 'validation_error' code, not one of the specific business codes
        // above) — this used to unconditionally blame the birth year and
        // bounce back to O4 regardless of which field actually failed
        // (e.g. a malformed parentContact, the most common real case,
        // since it's free-text entered right before this exact submit).
        // class-validator's message includes the failing property name
        // (see IsEmailOrPhone's defaultMessage / CreatePlayerDto's Max
        // birthYear message), so route off that instead of guessing.
        const message = err.message ?? '';
        if (message.includes('parentContact')) {
          // Already on O5 — no step change, just surface the real error
          // on the field the user actually just typed into.
          setO5Error(
            'Den kontaktuppgiften ser inte rätt ut — kolla att det är en riktig e-postadress eller ett telefonnummer.',
          );
        } else if (message.includes('screenName')) {
          setO3Error('Det namnet fungerar inte riktigt — testa ett annat!');
          setFocusNameOnO3(true);
          setStep('O3');
        } else if (message.includes('birthYear')) {
          // The picker already hard-limits its range client-side to match
          // the backend, so this should be unreachable in practice —
          // kept as a genuine defense-in-depth fallback, not the default.
          setO4Error('Hmm, det året ser inte rätt ut. Testa igen.');
          setStep('O4');
        } else {
          setO5Error('Något gick fel. Kolla uppgifterna och testa igen.');
        }
      } else {
        setO5Error('Något gick fel. Kolla din uppkoppling och testa igen.');
      }
    } finally {
      setO5Loading(false);
    }
  };

  switch (step) {
    case 'O1':
      return (
        <O1EnterCode
          initialCode={data.inviteCode}
          externalError={o1Error}
          selectCodeOnMount={selectCodeOnO1}
          onFound={(inviteCode, teamId, teamName) => {
            setO1Error(null);
            setSelectCodeOnO1(false);
            setData((prev) => ({
              ...prev,
              inviteCode,
              teamId,
              teamName,
              isCreatingTeam: false,
            }));
            setStep('O2');
          }}
          onNotFound={(inviteCode) => {
            setO1Error(null);
            setSelectCodeOnO1(false);
            setData((prev) => ({ ...prev, inviteCode, teamId: null }));
            setStep('O1a');
          }}
        />
      );

    case 'O1a':
      return (
        <O1aTeamNotFound
          inviteCode={data.inviteCode}
          onWrongCode={() => {
            setSelectCodeOnO1(true);
            setStep('O1');
          }}
          onCreateTeam={() => setStep('O1b')}
        />
      );

    case 'O1b':
      return (
        <O1bNameTeam
          inviteCode={data.inviteCode}
          initialTeamName={data.teamName ?? ''}
          externalError={o1bError}
          focusNameOnMount={focusNameOnO1b}
          onChangeCode={() => setStep('O1')}
          onNext={(teamName) => {
            setO1bError(null);
            setFocusNameOnO1b(false);
            setData((prev) => ({ ...prev, teamName }));
            setStep('O1c');
          }}
        />
      );

    case 'O1c':
      return (
        <O1cConfirmNewTeam
          teamName={data.teamName ?? ''}
          inviteCode={data.inviteCode}
          onConfirm={() => {
            setData((prev) => ({ ...prev, isCreatingTeam: true }));
            setStep('O3');
          }}
          onEditName={() => {
            setFocusNameOnO1b(true);
            setStep('O1b');
          }}
        />
      );

    case 'O2':
      return (
        <O2ConfirmTeam
          teamName={data.teamName ?? ''}
          onConfirm={() => setStep('O3')}
          onReject={() => {
            setData((prev) => ({
              ...prev,
              inviteCode: '',
              teamId: null,
              teamName: null,
            }));
            setStep('O1');
          }}
        />
      );

    case 'O3':
      return (
        <O3NameAvatar
          initialScreenName={data.screenName}
          initialAvatarId={data.avatarId}
          externalError={o3Error}
          focusNameOnMount={focusNameOnO3}
          onNext={(screenName, avatarId) => {
            setO3Error(null);
            setFocusNameOnO3(false);
            setData((prev) => ({ ...prev, screenName, avatarId }));
            setStep('O4');
          }}
        />
      );

    case 'O4':
      return (
        <O4BirthYear
          initialBirthYear={data.birthYear}
          externalError={o4Error}
          onNext={(birthYear) => {
            setO4Error(null);
            setData((prev) => ({ ...prev, birthYear }));
            setStep('O5');
          }}
        />
      );

    case 'O5':
      return (
        <O5ConsentAsk
          initialParentContact={data.parentContact}
          loading={o5Loading}
          errorText={o5Error}
          onSubmit={(parentContact) => {
            const next = { ...data, parentContact };
            setData(next);
            void submitPlayer(next);
          }}
        />
      );

    case 'O6':
      return (
        <O6Confirmation
          screenName={data.screenName}
          teamName={data.teamName ?? ''}
          teamCreated={data.teamCreated}
          isCaptain={data.isCaptain}
          inviteCode={data.inviteCode}
          onDone={onComplete}
        />
      );

    default:
      return null;
  }
}
