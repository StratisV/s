import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useHome } from '../../state/HomeProvider';
import { AddPersonPage } from './AddPersonPage';
import { HouseholdEditor } from './HouseholdEditor';
import { PersonPage } from './PersonPage';
import { ProfilePage } from './ProfilePage';
import { SHEET_MS, usePresence } from './usePresence';
import styles from './ProfileScreen.module.css';

/**
 * Profile, a full-screen cover that slides up over the app (README
 * "4. Profile"). The Household editor is pushed inside it from the right,
 * and a member's page (or Add Person) on top of that. Escape goes back one
 * page at a time, then closes. Unmounts once closed.
 */
export function ProfileScreen({ open, onClose }: { open: boolean; onClose(): void }) {
  const { mounted, shown } = usePresence(open, SHEET_MS);
  const { data, me } = useHome();
  if (!mounted || !data || !me) return null;
  return <ProfileCover open={open} shown={shown} onClose={onClose} />;
}

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

/** The page pushed over the Household editor: someone's page, or Add Person. */
type Pushed = { kind: 'person'; id: string } | { kind: 'add' };

function ProfileCover({ open, shown, onClose }: { open: boolean; shown: boolean; onClose(): void }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const editor = usePresence(editorOpen, SHEET_MS);
  // The pushed page keeps what it shows while it slides out. Each opening is a fresh page (key).
  const [person, setPerson] = useState<{ page: Pushed; open: boolean; key: number } | null>(null);
  const pushes = useRef(0);
  const personOpen = !!person?.open;
  /** The People row that gets focus back when the pushed page goes (a person added just now, say). */
  const returnRow = useRef<string | null>(null);
  const personPage = usePresence(personOpen, SHEET_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);
  const householdRowRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const personBackRef = useRef<HTMLButtonElement>(null);
  const addNameRef = useRef<HTMLInputElement>(null);
  const keyboardProxyRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const state = useRef({ editorOpen, personOpen, onClose });
  state.current = { editorOpen, personOpen, onClose };

  const openPerson = useCallback((id: string) => {
    returnRow.current = id;
    setPerson({ page: { kind: 'person', id }, open: true, key: ++pushes.current });
  }, []);
  const openAddPerson = useCallback(() => {
    // Focus a stand-in field inside the tap so iOS raises the keyboard; Name takes over the
    // focus once the page has slid in.
    keyboardProxyRef.current?.focus({ preventScroll: true });
    returnRow.current = null;
    setPerson({ page: { kind: 'add' }, open: true, key: ++pushes.current });
  }, []);
  const closePerson = useCallback(() => setPerson((p) => (p ? { ...p, open: false } : p)), []);
  const personAdded = useCallback((id: string) => {
    returnRow.current = id;
    setPerson((p) => (p ? { ...p, open: false } : p));
  }, []);

  // Focus moves into the cover when it opens and back to the avatar when it closes.
  useLayoutEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  useEffect(() => {
    if (shown) rootRef.current?.focus({ preventScroll: true });
  }, [shown]);
  useEffect(() => {
    if (open) return;
    // App makes the screen behind interactive again in its own effect, which runs
    // after this one: focusing the avatar only works from the next frame.
    const target = returnFocus.current;
    const raf = requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // The page underneath a pushed one is inert; focus follows the push and the pop.
  const wasPushed = useRef(false);
  useEffect(() => {
    if (profileRef.current) profileRef.current.inert = editorOpen;
    if (!editorOpen && wasPushed.current) householdRowRef.current?.focus({ preventScroll: true });
    wasPushed.current = editorOpen;
  }, [editorOpen]);
  useEffect(() => {
    if (editor.shown) backRef.current?.focus({ preventScroll: true });
  }, [editor.shown]);

  const personWasOpen = useRef(false);
  useEffect(() => {
    if (editorRef.current) editorRef.current.inert = personOpen;
    if (!personOpen && personWasOpen.current && person) {
      // Back to the person's row (or the one just added); Add Person when there is none (removed).
      const rows = editorRef.current?.querySelectorAll<HTMLElement>('[data-member-row]') ?? [];
      const row = Array.from(rows).find((r) => r.dataset.memberRow === returnRow.current);
      (row ?? editorRef.current?.querySelector<HTMLElement>('[data-add-person]'))?.focus({ preventScroll: true });
    }
    personWasOpen.current = personOpen;
  }, [personOpen, person]);
  const pushedKind = person?.page.kind;
  useEffect(() => {
    if (!personPage.shown) return;
    // Add Person starts in its Name field; a person's page on its back button.
    if (pushedKind === 'add') addNameRef.current?.focus({ preventScroll: true });
    else personBackRef.current?.focus({ preventScroll: true });
  }, [personPage.shown, pushedKind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An open action sheet handles its own Escape.
      if (document.querySelector('[role="alertdialog"]')) return;
      e.preventDefault();
      if (state.current.personOpen) closePerson();
      else if (state.current.editorOpen) setEditorOpen(false);
      else state.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePerson]);

  // Keep Tab inside the visible page.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const page = personOpen ? personRef.current : editorOpen ? editorRef.current : profileRef.current;
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
        <div
          ref={editorRef}
          className={`${styles.layer} ${styles.pushed}`}
          data-shown={editor.shown || undefined}
          data-covered={personPage.shown || undefined}
        >
          <HouseholdEditor
            onBack={() => setEditorOpen(false)}
            onOpenPerson={openPerson}
            onAddPerson={openAddPerson}
            backRef={backRef}
          />
        </div>
      ) : null}
      {editor.mounted && person && personPage.mounted ? (
        <div ref={personRef} className={`${styles.layer} ${styles.pushed}`} data-shown={personPage.shown || undefined}>
          {person.page.kind === 'add' ? (
            <AddPersonPage
              key={person.key}
              onBack={closePerson}
              onAdded={personAdded}
              backRef={personBackRef}
              nameRef={addNameRef}
            />
          ) : (
            <PersonPage key={person.key} memberId={person.page.id} onBack={closePerson} backRef={personBackRef} />
          )}
        </div>
      ) : null}
      {/* Not read-only: iOS only raises the keyboard for an editable field. */}
      <input
        ref={keyboardProxyRef}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
      />
    </div>
  );
}
