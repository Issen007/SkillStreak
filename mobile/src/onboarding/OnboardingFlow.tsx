import { useState } from 'react';

import { O1EnterCode } from './screens/O1EnterCode';
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

/** O1-O6 per docs/design/phase1-flows.md Part 1 — a linear flow with two
 * documented "jump back" recovery paths (409 -> O3, 404 -> O1), modeled as
 * a small state machine rather than a stack navigator: there's no deep
 * back-history to preserve beyond "which step am I on" plus the
 * accumulated form data. */
export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>('O1');
  const [data, setData] = useState<OnboardingData>(INITIAL_ONBOARDING_DATA);

  const [o1Error, setO1Error] = useState<string | null>(null);
  const [o3Error, setO3Error] = useState<string | null>(null);
  const [focusNameOnO3, setFocusNameOnO3] = useState(false);
  const [o5Loading, setO5Loading] = useState(false);
  const [o5Error, setO5Error] = useState<string | null>(null);

  switch (step) {
    case 'O1':
      return (
        <O1EnterCode
          initialCode={data.inviteCode}
          externalError={o1Error}
          onFound={(inviteCode, teamId, teamName) => {
            setO1Error(null);
            setData((prev) => ({ ...prev, inviteCode, teamId, teamName }));
            setStep('O2');
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
          onNext={(birthYear) => {
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
          onSubmit={async (parentContact) => {
            if (!data.inviteCode || !data.avatarId || data.birthYear === null) {
              // Defensive only — the flow can't reach O5 without these set.
              return;
            }
            setData((prev) => ({ ...prev, parentContact }));
            setO5Loading(true);
            setO5Error(null);
            try {
              const response = await createPlayer({
                inviteCode: data.inviteCode,
                screenName: data.screenName,
                avatarId: data.avatarId,
                birthYear: data.birthYear,
                parentContact,
              });
              await setSessionToken(response.sessionToken);
              setData((prev) => ({ ...prev, screenName: response.screenName }));
              setStep('O6');
            } catch (err) {
              if (err instanceof ApiError && err.code === 'screen_name_taken_in_team') {
                setO3Error('Det namnet är upptaget i laget — testa ett annat!');
                setFocusNameOnO3(true);
                setStep('O3');
              } else if (err instanceof ApiError && err.code === 'invite_code_not_found') {
                setData((prev) => ({ ...prev, teamId: null, teamName: null }));
                setO1Error('Lagkoden fungerar inte längre. Fråga din tränare om en ny kod.');
                setStep('O1');
              } else {
                setO5Error('Något gick fel. Kolla din uppkoppling och testa igen.');
              }
            } finally {
              setO5Loading(false);
            }
          }}
        />
      );

    case 'O6':
      return <O6Confirmation screenName={data.screenName} onDone={onComplete} />;

    default:
      return null;
  }
}
