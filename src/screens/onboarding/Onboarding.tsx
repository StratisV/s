import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { AuthUser } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { CreateHome } from './CreateHome';
import { JoinHome, type InviteCheck } from './JoinHome';
import { NotificationsStep } from './NotificationsStep';
import { ProfileStep, type ProfileDraft } from './ProfileStep';
import { DEFAULT_EMOJI, initialHomeDraft, suggestedName, type HomeDraft } from './setup';
import type { Enter } from './StepPage';
import { Welcome } from './Welcome';

type View = 'welcome' | 'profile' | 'household' | 'notifications';
const ORDER: Record<View, number> = { welcome: 0, profile: 1, household: 2, notifications: 3 };

/**
 * Sign-in and setup (README "5. Sign-in and setup"). App shows this while
 * signed out, while onboarding, and for the notifications step right after
 * creating or joining a household (onboardingTail).
 */
export function Onboarding() {
  const { phase, pendingInvite } = useHome();
  const setup = useSetupState(phase.kind === 'onboarding' ? phase.user : null, pendingInvite);

  let view: View;
  if (phase.kind === 'signedOut') view = 'welcome';
  else if (phase.kind === 'onboarding') view = setup.step;
  else view = 'notifications';

  const enter = useEnterDirection(view);

  switch (view) {
    case 'welcome':
      return <Welcome key={view} enter={enter} />;
    case 'profile':
      return (
        <ProfileStep
          key={view}
          enter={enter}
          email={phase.kind === 'onboarding' ? phase.user.email : ''}
          value={setup.profile}
          onChange={setup.setProfile}
          onContinue={() => setup.setStep('household')}
          onSignOut={setup.signOut}
          signingOut={setup.signingOut}
        />
      );
    case 'household': {
      const back = () => setup.setStep('profile');
      if (pendingInvite && !setup.inviteDeclined) {
        return (
          <JoinHome
            key={view}
            enter={enter}
            token={pendingInvite}
            check={setup.invite}
            profile={setup.profile}
            onBack={back}
            onRetry={setup.recheckInvite}
            onInvalid={setup.markInviteInvalid}
            onCreateInstead={setup.declineInvite}
          />
        );
      }
      return (
        <CreateHome
          key={`${view}-create`}
          enter={enter}
          profile={setup.profile}
          value={setup.home}
          onChange={setup.setHome}
          onBack={back}
        />
      );
    }
    case 'notifications':
      return <NotificationsStep key={view} enter={enter} />;
  }
}

/** Forward when moving to a later step, back to an earlier one; nothing for the first screen. */
function useEnterDirection(view: View): Enter {
  const last = useRef<{ view: View; enter: Enter } | null>(null);
  if (!last.current) last.current = { view, enter: null };
  else if (last.current.view !== view) {
    last.current = { view, enter: ORDER[view] > ORDER[last.current.view] ? 'forward' : 'back' };
  }
  return last.current.enter;
}

/** Everything typed during setup, kept while moving between steps and reset on sign-out. */
function useSetupState(user: AuthUser | null, inviteToken: string | null) {
  const { signOut, showToast, backend, dismissInvite } = useHome();
  const [step, setStep] = useState<'profile' | 'household'>('profile');
  // name: null until edited, so it follows the Google name once we know it.
  const [profileEdit, setProfileEdit] = useState<{ name: string | null; emoji: string }>({
    name: null,
    emoji: DEFAULT_EMOJI,
  });
  const [home, setHome] = useState<HomeDraft>(initialHomeDraft);
  const [inviteDeclined, setInviteDeclined] = useState(false);
  const [invite, setInvite] = useState<InviteCheck>({ status: 'loading' });
  const [inviteAttempt, setInviteAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const profile: ProfileDraft = {
    name: profileEdit.name ?? suggestedName(user?.name),
    emoji: profileEdit.emoji,
  };

  // Look the invite up as soon as we are signed in (the RPC needs a session),
  // so it is usually ready by the time the profile is done.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId || !inviteToken) return;
    let alive = true;
    setInvite({ status: 'loading' });
    backend
      .getInvitePreview(inviteToken)
      .then((preview) => alive && setInvite(preview ? { status: 'valid', preview } : { status: 'invalid' }))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof BackendError && err.code === 'invalid_invite') setInvite({ status: 'invalid' });
        else setInvite({ status: 'error', message: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [backend, userId, inviteToken, inviteAttempt]);

  const reset = useCallback(() => {
    setStep('profile');
    setProfileEdit({ name: null, emoji: DEFAULT_EMOJI });
    setHome(initialHomeDraft());
    setInviteDeclined(false);
  }, []);

  // A different account (or none) starts over.
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current !== userId && userId !== null) reset();
    lastUser.current = userId ?? lastUser.current;
  }, [userId, reset]);

  return {
    step,
    setStep,
    profile,
    setProfile: (next: ProfileDraft) => setProfileEdit({ name: next.name, emoji: next.emoji }),
    home,
    setHome,
    invite,
    inviteDeclined,
    recheckInvite: () => setInviteAttempt((n) => n + 1),
    markInviteInvalid: () => setInvite({ status: 'invalid' }),
    // Forgotten for good, so a reload doesn't bring the Join screen back.
    declineInvite: () => {
      setInviteDeclined(true);
      dismissInvite();
    },
    signingOut,
    signOut: async () => {
      if (signingOut) return;
      setSigningOut(true);
      try {
        await signOut();
        reset();
      } catch (err) {
        showToast(errorMessage(err));
      } finally {
        setSigningOut(false);
      }
    },
  };
}
