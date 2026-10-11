import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_NAME } from '../../lib/constants';
import { shareOrCopy } from '../../lib/shareSheet';
import type { IssuedCode } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { ShareIcon } from '../../ui/icons';
import { PrimaryButton } from '../onboarding/StepPage';
import { COPIED_TOAST, SHARE_FAILED_TOAST } from '../share/useShare';
import { INVITE_TITLE } from './invite';
import styles from './CodeSheet.module.css';

/** A code just made, and who it is for. */
export interface CodeFor {
  code: IssuedCode;
  /** The person it signs in as; null when it is for yourself ("Add another device"). */
  name: string | null;
}

/** "Code for Shea", or "Code for another device". */
export function codeTitle(name: string | null): string {
  return name ? `Code for ${name}` : 'Code for another device';
}

/** What the code is for, under it. */
export function codeNote(name: string | null): string {
  const where = name ? `On ${name}’s phone` : 'On your other phone or tablet';
  return `Works once, for 7 days. ${where}, open ${APP_NAME} and enter it, or open the link.`;
}

/** What Share sends: the link, then the code to type. */
export function codeShareText(code: IssuedCode): string {
  return `Join our home on ${APP_NAME}: ${code.link}\nCode: ${code.code}`;
}

/** "ABCD-EFGH" read out a letter at a time ("A B C D, E F G H"), for VoiceOver. */
function spelled(code: string): string {
  return code
    .split('-')
    .map((group) => group.split('').join(' '))
    .join(', ');
}

interface CodeSheetProps {
  /** What the sheet shows; kept while it slides away. */
  shown: CodeFor | null;
  open: boolean;
  onClose(): void;
}

/**
 * The code sheet (server mode; docs/ARCHITECTURE.md "Screens"): a fresh sign-in code for
 * someone, shown once, large and selectable, with what to do with it, Share (the system share
 * sheet, else the clipboard) and Done. A bottom sheet over everything, like the action sheets:
 * Escape and the backdrop close it, Tab stays inside, and focus goes back to the button that
 * asked for the code.
 */
export function CodeSheet({ shown, open, onClose }: CodeSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const noteId = useId();
  const sharing = useRef(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setStatus(null);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const sheet = sheetRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet?.focus({ preventScroll: true });
    // Capture, and stop it there: the Profile cover underneath must not also see Escape or Tab.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      e.preventDefault();
      e.stopPropagation();
      const list = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      list[next].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const active = document.activeElement;
      const lost = !active || active === document.body || !!sheet?.contains(active);
      if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!mounted || !shown) return null;
  const { code, name } = shown;

  const share = () => {
    // Straight from the tap: Safari only opens the share sheet while the tap still counts.
    if (sharing.current) return;
    sharing.current = true;
    setStatus(null);
    const text = codeShareText(code);
    void shareOrCopy({ title: INVITE_TITLE, text }, text)
      .then((outcome) => {
        if (outcome === 'copied') setStatus(COPIED_TOAST);
        else if (outcome === 'failed') setStatus(SHARE_FAILED_TOAST);
      })
      .finally(() => {
        sharing.current = false;
      });
  };

  return createPortal(
    <div className={styles.root} data-shown={visible || undefined}>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={noteId}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <h2 id={titleId} className={styles.title}>
          {codeTitle(name)}
        </h2>
        <p className={styles.code}>
          <span className={styles.letters} aria-hidden="true">
            {code.code}
          </span>
          <span className="visually-hidden">{spelled(code.code)}</span>
        </p>
        <p id={noteId} className={styles.note}>
          {codeNote(name)}
        </p>
        <div className={styles.actions}>
          <PrimaryButton onClick={share}>
            <span className={styles.shareLabel}>
              <ShareIcon size={20} />
              Share
            </span>
          </PrimaryButton>
          <p className={styles.status} role="status">
            {status}
          </p>
          <button type="button" className={styles.done} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Makes a code for someone and shows it in the code sheet ("Invite Shea", "Add another
 * device", "Sign in on a new phone"). A failure says why in a toast. `busy` is the person a
 * code is being made for, so that button can say it is working.
 */
export function useIssueCode() {
  const { createCode, showToast } = useHome();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ shown: CodeFor; open: boolean } | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const issue = useCallback(
    async (memberId: string, name: string | null) => {
      if (working.current) return;
      working.current = true;
      setBusy(memberId);
      try {
        const code = await createCode(memberId);
        if (alive.current) setSheet({ shown: { code, name }, open: true });
      } catch (err) {
        showToast(errorMessage(err));
      } finally {
        working.current = false;
        if (alive.current) setBusy(null);
      }
    },
    [createCode, showToast],
  );

  const close = useCallback(() => setSheet((s) => (s ? { ...s, open: false } : s)), []);
  const element = <CodeSheet shown={sheet?.shown ?? null} open={!!sheet?.open} onClose={close} />;
  return { issue, busy, sheet: element };
}
