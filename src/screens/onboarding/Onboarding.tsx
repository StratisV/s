import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import { firstFreeEmoji, hasJoined } from '../../lib/logic/people';
import type { AuthUser } from '../../lib/types';
import { errorMessage, useHome, type Phase } from '../../state/HomeProvider';
import { ClaimWelcome } from './ClaimWelcome';
import { CreateHome } from './CreateHome';
import { ImportBlocked, ImportHome } from './ImportHome';
import { InviteInvalid } from './InviteInvalid';
import { JoinHome, type InviteCheck } from './JoinHome';
import { NotificationsStep } from './NotificationsStep';
import { PeopleStep } from './PeopleStep';
import { PrivateHome } from './PrivateHome';
import { ProfileStep, type ProfileDraft } from './ProfileStep';
import { DEFAULT_EMOJI, initialHomeDraft, suggestedName, type HomeDraft } from './setup';
import type { Enter } from './StepPage';
import { Welcome } from './Welcome';

type View =
  | 'welcome'
  | 'private'
  | 'import'
  | 'inviteInvalid'
  | 'profile'
  | 'household'
  | 'claimed'
  | 'importHere'
  | 'people'
  | 'notifications';
const ORDER: Record<View, number> = {
  welcome: 0,
  private: 1,
  import: 1,
  inviteInvalid: 1,
  profile: 2,
  household: 3,
  claimed: 3,
  importHere: 4,
  people: 5,
  notifications: 6,
};

/** The private screen's line when the invite link it came with was no good. */
export const INVITE_EXPIRED = 'That invite link has expired.';

/**
 * Sign-in and setup (README "5. Sign-in and setup", docs/ARCHITECTURE.md "One home"). App
 * shows this while signed out, while not in the home (phases 'onboarding' and 'private'), and
 * for the last step(s) right after creating, joining, claiming or importing (onboardingTail).
 *
 * - 'onboarding' (no home exists): "Bring over the home from this phone" when this browser
 *   kept one (demoImport), else Profile, then Create home (or Join, with an invite link). An
 *   invite link that is no longer valid says so first, and offers Check Again.
 * - 'private' (a home exists, nobody there has this email): "This home is private" (with a
 *   line about the phone's own home, if it kept one). With an invite link: Profile, then Join,
 *   never "Set up a new home instead"; a link that is no longer valid goes straight to the
 *   private screen, which says so.
 * - 'ready' with onboardingTail: "Welcome home" after a claim; the phone's own home, offered
 *   while the home is untouched or else said once; after bringing a home over, the emails of
 *   the people who came along; then the notifications step.
 */
export function Onboarding() {
  const { phase, pendingInvite, demoImport, demoImportMode, claimed, invitePeople, data } = useHome();
  const setupUser = phase.kind === 'onboarding' || phase.kind === 'private' ? phase.user : null;
  const setup = useSetupState(setupUser, pendingInvite, phase.kind);
  const inviting = !!pendingInvite && !setup.inviteDeclined;
  const invalidInvite = inviting && setup.invite.status === 'invalid';
  const waiting = data ? data.members.filter((m) => !hasJoined(m) && !m.email) : [];

  let view: View;
  if (phase.kind === 'signedOut') view = 'welcome';
  else if (phase.kind === 'onboarding') {
    if (demoImport && demoImportMode === 'create') view = 'import';
    else if (invalidInvite) view = 'inviteInvalid';
    else view = setup.step;
  } else if (phase.kind === 'private') view = inviting && !invalidInvite ? setup.step : 'private';
  else if (phase.kind === 'ready' && claimed) view = 'claimed';
  else if (phase.kind === 'ready' && demoImport) view = 'importHere';
  else if (phase.kind === 'ready' && invitePeople && waiting.length > 0) view = 'people';
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
          notice={invalidInvite || setup.inviteExpired ? INVITE_EXPIRED : null}
          phoneHome={demoImport}
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
          mode="create"
          onSignOut={setup.signOut}
          signingOut={setup.signingOut}
        />
      ) : null;
    case 'inviteInvalid':
      return <InviteInvalid key={view} enter={enter} onDecline={setup.declineInvite} />;
    case 'profile':
      return (
        <ProfileStep
          key={view}
          enter={enter}
          email={setupUser?.email ?? ''}
          value={setup.profile}
          onChange={setup.setProfile}
          onContinue={() => setup.setStep('household')}
          onBack={canReopenOffer(phase, setup) ? setup.reopenImport : undefined}
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
    case 'importHere':
      return demoImport ? (
        demoImportMode === 'replace' ? (
          <ImportHome key={`${view}-replace`} enter={enter} summary={demoImport} mode="replace" />
        ) : (
          <ImportBlocked key={`${view}-blocked`} enter={enter} summary={demoImport} />
        )
      ) : null;
    case 'people':
      return <PeopleStep key={view} enter={enter} />;
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

/** Profile's Back returns to the offer after Start Fresh (before a home is created). */
function canReopenOffer(phase: Phase, setup: { canReopenImport: boolean }): boolean {
  return phase.kind === 'onboarding' && setup.canReopenImport;
}

/** Everything typed during setup, kept while moving between steps and reset on sign-out. */
function useSetupState(user: AuthUser | null, inviteToken: string | null, phaseKind: Phase['kind']) {
  const { signOut, showToast, backend, dismissInvite, canReopenDemoImport, reopenDemoImport } = useHome();
  const [step, setStep] = useState<'profile' | 'household'>('profile');
  // name and emoji: null until edited, so they follow the Google name (and, with an invite,
  // the first emoji nobody in that home has) once we know them.
  const [profileEdit, setProfileEdit] = useState<{ name: string | null; emoji: string | null }>({
    name: null,
    emoji: null,
  });
  const [home, setHome] = useState<HomeDraft>(initialHomeDraft);
  const [inviteDeclined, setInviteDeclined] = useState(false);
  /** The invite link turned out to be no good while a home exists: the private screen says so. */
  const [inviteExpired, setInviteExpired] = useState(false);
  const [invite, setInvite] = useState<InviteCheck>({ status: 'loading' });
  const [inviteAttempt, setInviteAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const inviting = !!inviteToken && !inviteDeclined;
  const taken = inviting && invite.status === 'valid' ? invite.preview.emojis : [];
  const profile: ProfileDraft = {
    name: profileEdit.name ?? suggestedName(user?.name),
    emoji: profileEdit.emoji ?? (taken.length ? firstFreeEmoji(taken) : DEFAULT_EMOJI),
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
    setProfileEdit({ name: null, emoji: null });
    setHome(initialHomeDraft());
    setInviteDeclined(false);
    setInviteExpired(false);
  }, []);

  // A home exists and the link is no good: forget the link (a reload won't bring it back),
  // and the private screen says why there is nothing to join.
  const expiredWhilePrivate = phaseKind === 'private' && inviting && invite.status === 'invalid';
  useEffect(() => {
    if (!expiredWhilePrivate) return;
    setInviteExpired(true);
    setInviteDeclined(true);
    dismissInvite();
  }, [expiredWhilePrivate, dismissInvite]);

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
    inviteExpired,
    canReopenImport: canReopenDemoImport,
    reopenImport: reopenDemoImport,
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
