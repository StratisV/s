import { useId, useState } from 'react';
import { useHome } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { EmojiGrid } from './EmojiGrid';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { DEFAULT_EMOJI } from './setup';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

/**
 * "Welcome home, Shea" (phase 'ready' with onboardingTail and claimed; docs/ARCHITECTURE.md
 * "One home"): sign-in just made this account the person someone at home had added. They keep
 * the name, emoji and colour already set; this step lets them confirm or change the emoji,
 * then the notifications step follows.
 */
export function ClaimWelcome({ enter }: { enter: Enter }) {
  const { me, data, confirmClaimed } = useHome();
  const [emoji, setEmoji] = useState(() => me?.emoji || DEFAULT_EMOJI);
  const [busy, setBusy] = useState(false);
  const emojiLabelId = useId();
  const name = me?.name ?? '';
  const title = name ? `Welcome home, ${name}` : 'Welcome home';

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await confirmClaimed(emoji);
      // Onboarding moves on to the notifications step by itself.
    } catch {
      // The provider already said it wasn't saved; stay so they can try again.
      setBusy(false);
    }
  };

  return (
    <StepPage label={title} enter={enter} nav={null}>
      <div className={shared.titleBlock}>
        <h1 className={shared.title}>{title}</h1>
        <p className={shared.subtitle}>
          {data?.household.name ?? 'Your home'} is all set up for you. Pick your emoji.
        </p>
      </div>

      <div className={styles.avatar}>
        <Avatar
          key={emoji}
          className={styles.pop}
          emoji={emoji}
          size={112}
          emojiSize={62}
          background="var(--card)"
          shadow="0 2px 12px rgba(0,0,0,0.06)"
        />
      </div>

      <span id={emojiLabelId} className="visually-hidden">
        Your emoji
      </span>
      <EmojiGrid value={emoji} onChange={setEmoji} labelledBy={emojiLabelId} disabled={busy} />

      <div className={shared.spacer} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void confirm()} busy={busy}>
          Continue
        </PrimaryButton>
      </div>
    </StepPage>
  );
}
