import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useHome } from '../../state/HomeProvider';
import { HouseholdEditor } from './HouseholdEditor';
import { ProfilePage } from './ProfilePage';
import { SHEET_MS, usePresence } from './usePresence';
import styles from './ProfileScreen.module.css';

/**
 * Profile, a full-screen cover that slides up over the app (README
 * "4. Profile"). The Household editor is pushed inside it from the right.
 * Escape goes back from the editor, then closes. Unmounts once closed.
 */
export function ProfileScreen({ open, onClose }: { open: boolean; onClose(): void }) {
  const { mounted, shown } = usePresence(open, SHEET_MS);
  const { data, me } = useHome();
  if (!mounted || !data || !me) return null;
  return <ProfileCover open={open} shown={shown} onClose={onClose} />;
}

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

function ProfileCover({ open, shown, onClose }: { open: boolean; shown: boolean; onClose(): void }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const editor = usePresence(editorOpen, SHEET_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const householdRowRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const state = useRef({ editorOpen, onClose });
  state.current = { editorOpen, onClose };

  // Focus moves into the cover when it opens and back to the avatar when it closes.
  useLayoutEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  useEffect(() => {
    if (shown) rootRef.current?.focus({ preventScroll: true });
  }, [shown]);
  useEffect(() => {
    if (!open) returnFocus.current?.focus({ preventScroll: true });
  }, [open]);

  // The page underneath the editor is inert; focus follows the push and the pop.
  const wasPushed = useRef(false);
  useEffect(() => {
    if (profileRef.current) profileRef.current.inert = editorOpen;
    if (!editorOpen && wasPushed.current) householdRowRef.current?.focus({ preventScroll: true });
    wasPushed.current = editorOpen;
  }, [editorOpen]);
  useEffect(() => {
    if (editor.shown) backRef.current?.focus({ preventScroll: true });
  }, [editor.shown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An open action sheet handles its own Escape.
      if (document.querySelector('[role="alertdialog"]')) return;
      e.preventDefault();
      if (state.current.editorOpen) setEditorOpen(false);
      else state.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Keep Tab inside the visible page.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const page = editorOpen ? editorRef.current : profileRef.current;
    if (!page) return;
    const items = Array.from(page.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !page.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !page.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className={styles.cover}
      data-shown={shown || undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      <div ref={profileRef} className={styles.layer} data-covered={editor.shown || undefined}>
        <ProfilePage onDone={onClose} onOpenHousehold={() => setEditorOpen(true)} householdRowRef={householdRowRef} />
      </div>
      {editor.mounted ? (
        <div ref={editorRef} className={`${styles.layer} ${styles.pushed}`} data-shown={editor.shown || undefined}>
          <HouseholdEditor onBack={() => setEditorOpen(false)} backRef={backRef} />
        </div>
      ) : null}
    </div>
  );
}
