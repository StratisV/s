import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../../lib/clipboard';
import { goalsLinkUrl, goalsShareText, publicGoalsOf, weekDates, weekStart } from '../../lib/logic/goals';
import { shareOrCopy } from '../../lib/shareSheet';
import { appBaseUrl } from '../../lib/sharedLink';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { CheckIcon, ShareIcon } from '../../ui/icons';
import { CopyIcon, LinkIcon } from './icons';
import styles from './GoalsShareSheet.module.css';

/** What the share sheet's title says. */
export const SHARE_TITLE = 'Share this week’s goals';
/** What the share sheet promises about the link, under the preview. */
export const SHARE_NOTE =
  'Anyone with the link sees this week’s goals as they change, and who is on each by first name. Nothing else of the home, and no sign-in.';
export const LINK_COPIED = 'Link copied.';
export const LINK_OFF = 'The link is off. Anyone who opens it now sees that it is no longer active.';

/** The most goals the preview lists before "and N more". */
const PREVIEW_MAX = 4;

/** Whether this browser has a share sheet (iPhone, Android): else Copy Link is the way. */
const hasShareSheet = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Share this week's goals (docs/ARCHITECTURE.md "Goals for the week"): a bottom sheet with a
 * preview of exactly what the public link shows (this week's goals, ticks and first names),
 * what it promises, then Share Link (the system share sheet, so WhatsApp is one tap; where there
 * is none, Copy Link), Copy Link, and Turn Off Link (confirmed) while a link is on. The first
 * Share or Copy makes the link; later ones use the same one. Escape and the backdrop close it,
 * Tab stays inside.
 */
export function GoalsShareSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { data, today, goalsLink, stopGoalsLink } = useHousehold();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const confirming = useRef(false);
  confirming.current = confirmOff;
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const noteId = useId();
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setStatus(null);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    // Closed and never shown: nothing to take away.
    if (!mountedRef.current) return;
    setVisible(false);
    setConfirmOff(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const sheet = sheetRef.current;
    sheet?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // The confirmation over it has the keys while it is up.
      if (confirming.current) return;
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
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, mounted]);

  if (!mounted) return null;

  const link = data.goals.link;
  const url = link ? goalsLinkUrl(appBaseUrl(), link.token) : null;
  const monday = weekStart(today);
  const view = publicGoalsOf(data.goals.list, data.members, monday);
  const shown = view.goals.slice(0, PREVIEW_MAX);
  const more = view.goals.length - shown.length;
  const canShare = hasShareSheet();

  /** The link: the one there is, else a new one (null when it couldn't be made: the toast says why). */
  const theLink = async (): Promise<string | null> => {
    if (url) return url;
    try {
      const made = await goalsLink();
      return goalsLinkUrl(appBaseUrl(), made.token);
    } catch {
      return null;
    }
  };

  const share = async () => {
    // Straight from the tap (the link, if it has to be made first, takes a moment): Safari only
    // opens the share sheet while the tap still counts.
    if (working) return;
    setWorking(true);
    setStatus(null);
    const made = !url;
    const href = await theLink();
    if (href) {
      const outcome = await shareOrCopy({ title: 'Goals for the week', text: 'Our goals for the week', url: href }, goalsShareText(href));
      if (outcome === 'copied') setStatus(LINK_COPIED);
      else if (outcome === 'failed') setStatus(made ? 'The link is ready. Tap Share Link again.' : 'Couldn’t share. Try again.');
    }
    setWorking(false);
  };

  const copy = async () => {
    if (working) return;
    setWorking(true);
    setStatus(null);
    const made = !url;
    const href = await theLink();
    if (href) {
      const ok = await copyText(href);
      setStatus(ok ? LINK_COPIED : made ? 'The link is ready. Tap Copy Link again.' : 'Couldn’t copy. Try again.');
    }
    setWorking(false);
  };

  const turnOff = () => {
    setConfirmOff(false);
    setStatus(null);
    void stopGoalsLink()
      .then(() => setStatus(LINK_OFF))
      .catch(() => {});
    sheetRef.current?.focus({ preventScroll: true });
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
        data-goals-share-sheet=""
      >
        <div className={styles.grabber} aria-hidden="true" />
        <h2 id={titleId} className={styles.title}>
          {SHARE_TITLE}
        </h2>

        {/* What anyone with the link sees, as the public page shows it. */}
        <figure className={styles.preview} aria-label="What the link shows">
          <div className={styles.previewHead}>
            <span className={styles.previewTitle}>Goals for the week</span>
            <span className={styles.previewDates}>{weekDates(monday, today)}</span>
          </div>
          {shown.length ? (
            <ul className={styles.previewList}>
              {shown.map((g, i) => (
                <li key={i} className={styles.previewRow} data-done={g.done || undefined}>
                  <span className={styles.previewTick} aria-label={g.done ? 'Done' : 'Not done'}>
                    {g.done ? <CheckIcon size={11} strokeWidth={3.4} /> : null}
                  </span>
                  <span className={styles.previewText}>{g.title}</span>
                  {g.person ? (
                    <span className={styles.previewWho}>
                      <span aria-hidden="true">{g.person.emoji}</span> {g.person.name}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.previewEmpty}>Nothing planned yet.</p>
          )}
          {more > 0 ? <p className={styles.previewMore}>and {more} more</p> : null}
        </figure>

        <p id={noteId} className={styles.note}>
          {SHARE_NOTE}
        </p>
        {url ? (
          <p className={styles.url} data-goals-url="">
            <LinkIcon size={15} />
            <span className={styles.urlText}>{url.replace(/^https?:\/\//, '')}</span>
          </p>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={canShare ? share : copy} aria-busy={working || undefined}>
            {canShare ? <ShareIcon size={20} /> : <CopyIcon size={20} />}
            {canShare ? 'Share Link' : 'Copy Link'}
          </button>
          <p className={styles.status} role="status">
            {status}
          </p>
          {canShare ? (
            <button type="button" className={styles.textButton} onClick={copy}>
              Copy Link
            </button>
          ) : null}
          {link ? (
            <button type="button" className={`${styles.textButton} ${styles.destructive}`} onClick={() => setConfirmOff(true)}>
              Turn Off Link
            </button>
          ) : null}
          <button type="button" className={styles.done} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      <ActionSheet
        open={confirmOff}
        title="Turn off the link?"
        message="Anyone who opens it will see that it is no longer active. You can make a new link later."
        actions={[{ label: 'Turn Off Link', destructive: true, onSelect: turnOff }]}
        onCancel={() => setConfirmOff(false)}
      />
    </div>,
    document.body,
  );
}
