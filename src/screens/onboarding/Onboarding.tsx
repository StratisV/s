import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { AuthUser } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { ClaimWelcome } from './ClaimWelcome';
import { CreateHome } from './CreateHome';
import { ImportHome } from './ImportHome';
import { JoinHome, type InviteCheck } from './JoinHome';
import { NotificationsStep } from './NotificationsStep';
import { PrivateHome } from './PrivateHome';
import { ProfileStep, type ProfileDraft } from './ProfileStep';
import { DEFAULT_EMOJI, initialHomeDraft, suggestedName, type HomeDraft } from './setup';
import type { Enter } from './StepPage';
import { Welcome } from './Welcome';

type View = 'welcome' | 'private' | 'import' | 'profile' | 'household' | 'claimed' | 'notifications';
const ORDER: Record<View, number> = {
  welcome: 0,
  private: 1,
  import: 1,
  profile: 2,
  household: 3,
  claimed: 3,
  notifications: 4,
};

/**
 * Sign-in and setup (README "5. Sign-in and setup", docs/ARCHITECTURE.md "One home"). App
 * shows this while signed out, while not in the home (phases 'onboarding' and 'private'), and
 * for the last step(s) right after creating, joining, claiming or importing (onboardingTail).
 *
 * - 'onboarding' (no home exists): "Bring over the home from this phone" when this browser
 *   kept one (demoImport), else Profile, then Create home (or Join, with an invite link).
 * - 'private' (a home exists, nobody there has this email): "This home is private". With an
 *   invite link: Profile, then Join, never "Set up a new home instead".
 * - 'ready' with onboardingTail: "Welcome home" after a claim, then the notifications step.
 */
export function Onboarding() {
  const { phase, pendingInvite, demoImport, claimed } = useHome();
  const setupUser = phase.kind === 'onboarding' || phase.kind === 'private' ? phase.user : null;
  const setup = useSetupState(setupUser, pendingInvite);
  const inviting = !!pendingInvite && !setup.inviteDeclined;

  let view: View;
  if (phase.kind === 'signedOut') view = 'welcome';
  else if (phase.kind === 'onboarding') view = demoImport ? 'import' : setup.step;
  else if (phase.kind === 'private') view = inviting ? setup.step : 'private';
  else if (phase.kind === 'ready' && claimed) view = 'claimed';
  else view = 'notifications';

  const enter = useEnterDirection(view);

  switch (view) {
    case 'welcome':
      return <Welcome key={view} enter={enter} />;
    case 'private':
      return (
        <PrivateHome
          key={view}
          enter={enter}
          email={phase.kind === 'private' ? phase.email : ''}
          emailVerified={phase.kind === 'private' ? phase.emailVerified : true}
          onSignOut={setup.signOut}
          signingOut={setup.signingOut}
        />
      );
    case 'import':
      return demoImport ? (
        <ImportHome
          key={view}
          enter={enter}
          summary={demoImport}
          onSignOut={setup.signOut}
          signingOut={setup.signingOut}
        />
      ) : null;
    case 'profile':
      return (
        <ProfileStep
          key={view}
          enter={enter}
          email={setupUser?.email ?? ''}
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
            onDecline={setup.declineInvite}
            canCreate={phase.kind === 'onboarding'}
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
    case 'claimed':
      return <ClaimWelcome key={view} enter={enter} />;
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
