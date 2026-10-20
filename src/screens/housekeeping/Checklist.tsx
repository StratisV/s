import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { HOUSEKEEPING_NEW_TASK, TEXT_LIMITS } from '../../lib/constants';
import { areaHeadingLabel, areaProgress, WHOLE_HOME, type AreaChecklist, type ChecklistRow } from '../../lib/logic/housekeeping';
import { AreaArt } from '../../ui/area-art/AreaArt';
import { scrollParent } from '../../ui/DatePicker';
import { EmojiText } from '../../ui/EmojiText';
import { CheckIcon, ChevronDownIcon } from '../../ui/icons';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import styles from './Checklist.module.css';

interface ChecklistProps {
  /** Read out as the group's name: "Tasks today", "Tasks on Thursday 1 October". */
  legend: string;
  /** The day's cards, top to bottom (areaChecklists()): Whole home, each area, then any other section. */
  cards: AreaChecklist[];
  /** A day before today: its visit keeps the tasks it had ("No tasks" on a card with none). */
  past: boolean;
  /** Which cards are open is remembered per household while the app runs (the tab and the day come and go). */
  householdId: string;
  /** "🦊 Ela · 10:42" under a ticked row (who ticked it, when); null when not done. */
  bylineOf(row: ChecklistRow): string | null;
  onTick(row: ChecklistRow, done: boolean): void;
  /**
   * Adds a task to a card (today only: an Add Task row then ends each card). Resolves once it
   * is stored; rejects when it couldn't be (the provider's toast says why).
   */
  onAdd?(card: AreaChecklist, title: string): Promise<void>;
}

/** The cards open, per household, while the app runs. */
const opened = new Map<string, ReadonlySet<string>>();

/** The open cards (by key), remembered for the household; toggle() opens or closes one. */
function useOpenCards(householdId: string): [ReadonlySet<string>, (key: string) => void] {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => opened.get(householdId) ?? new Set());
  useEffect(() => {
    opened.set(householdId, open);
  }, [householdId, open]);
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return [open, toggle];
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * A card opening low on the screen: brings up as much of what it opens (`height` px under its
 * header) as fits above the foot of the scroll area (its bottom padding keeps the tab bar
 * clear), without taking the header up under the top of the screen. It scrolls as the card
 * opens; at once with Reduce Motion.
 */
function revealOpening(header: HTMLElement, height: number): void {
  const scroller = scrollParent(header);
  if (!scroller) return;
  const style = getComputedStyle(scroller);
  const box = scroller.getBoundingClientRect();
  const top = box.top + (parseFloat(style.scrollPaddingTop) || 0);
  const bottom = box.bottom - (parseFloat(style.paddingBottom) || 0);
  const head = header.getBoundingClientRect();
  const delta = Math.min(head.bottom + height - bottom, head.top - top);
  if (delta > 1) scroller.scrollBy?.({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/**
 * The day's tasks as a stack of area cards, one a row, full width (docs/ARCHITECTURE.md
 * "Housekeeping", UI): Whole home first (the tasks in no section), then each area in the
 * household's order, then any section no area is called. Each card's header is one button:
 * the area's picture as a rounded landscape thumbnail, its name and the day's progress ("2 of
 * 5 done", "All done" in green, "No tasks yet" in grey), and a chevron. A tap opens the card in
 * place, smoothly (at once with Reduce Motion), to its tasks as iOS-style round checkboxes,
 * then (today) Add Task; a tap on the header again closes it. Several can be open. The whole
 * row toggles; a ticked row says who ticked it and when, which is also the checkbox's
 * description.
 */
export function Checklist({ legend, cards, past, householdId, bylineOf, onTick, onAdd }: ChecklistProps) {
  const [open, toggle] = useOpenCards(householdId);
  return (
    <fieldset className={styles.checklist}>
      <legend className="visually-hidden">{legend}</legend>
      <div className={styles.stack}>
        {cards.map((card) => (
          <AreaCard
            key={card.key}
            card={card}
            open={open.has(card.key)}
            onToggle={() => toggle(card.key)}
            past={past}
            bylineOf={bylineOf}
            onTick={onTick}
            onAdd={onAdd}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** A task being added: its row shows the name, quieter, until the stored one arrives. */
interface Saving {
  key: number;
  title: string;
  /** Saved by leaving its field: it shows where the field was, and Add Task comes back once it is stored. */
  inPlace: boolean;
}

function AreaCard({
  card,
  open,
  onToggle,
  past,
  bylineOf,
  onTick,
  onAdd,
}: {
  card: AreaChecklist;
  open: boolean;
  onToggle(): void;
  past: boolean;
  bylineOf: ChecklistProps['bylineOf'];
  onTick: ChecklistProps['onTick'];
  onAdd: ChecklistProps['onAdd'];
}) {
  const panelId = useId();
  const headerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const total = card.rows.length;
  const state = total === 0 ? 'empty' : card.done === total ? 'done' : 'some';

  // Shut, its rows are out of reach (focus, VoiceOver, find in page) as they slide away.
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.inert = !open;
  }, [open]);

  // Opened by a tap: bring up what it opens when it is low on the screen.
  const revealNext = useRef(false);
  useLayoutEffect(() => {
    if (!open || !revealNext.current) return;
    revealNext.current = false;
    if (headerRef.current && innerRef.current) revealOpening(headerRef.current, innerRef.current.scrollHeight);
  }, [open]);

  // ── Adding (today) ─────────────────────────────────────

  const [draft, setDraft] = useState<{ key: number; text: string } | null>(null);
  const draftOpen = useRef(false);
  draftOpen.current = draft !== null;
  const [saving, setSaving] = useState<Saving[]>([]);
  const keys = useRef(0);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const save = (title: string, inPlace: boolean) => {
    if (!onAdd) return;
    const key = ++keys.current;
    setSaving((s) => [...s, { key, title, inPlace }]);
    onAdd(card, title)
      .catch(() => {
        // Couldn't save (the toast says why): the name comes back in its field, to try again.
        if (!draftOpen.current) setDraft({ key: ++keys.current, text: title });
      })
      .finally(() => setSaving((s) => s.filter((x) => x.key !== key)));
  };

  /** Add Task: the row becomes the new task's field, shown and focused inside the tap (so iOS raises the keyboard). */
  const startDraft = () => {
    flushSync(() => setDraft({ key: ++keys.current, text: '' }));
    fieldRef.current?.focus();
  };

  /** The field goes: what was typed is added when it was left; Escape (or Enter with nothing typed) adds nothing. */
  const endDraft = (how: 'enter' | 'blur' | 'escape', text: string) => {
    if (how === 'blur' && text.trim()) save(text.trim(), true);
    setDraft(null);
    // From the keyboard, back to Add Task (Enter there starts another).
    if (how !== 'blur') requestAnimationFrame(() => addRef.current?.focus());
  };

  const waiting = saving.some((s) => s.inPlace);

  return (
    <div className={styles.card} data-card={card.key} data-open={open || undefined} data-state={state}>
      <h3 className={styles.heading}>
        <button
          ref={headerRef}
          type="button"
          className={styles.header}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={areaHeadingLabel(card.title, card.done, total, past)}
          onClick={() => {
            revealNext.current = !open;
            onToggle();
          }}
        >
          <span className={styles.thumb}>
            <AreaArt name={card.kind === 'home' ? WHOLE_HOME : card.title} seed={card.seed} className={styles.art} />
          </span>
          <span className={styles.label}>
            <span className={styles.name}>{card.title}</span>
            <span className={styles.progress} data-progress="">
              {state === 'done' ? <CheckIcon size={13} strokeWidth={3.2} className={styles.tick} /> : null}
              {areaProgress(card.done, total, past)}
            </span>
          </span>
          <ChevronDownIcon size={14} strokeWidth={2.2} className={styles.chevron} />
        </button>
      </h3>
      <div
        ref={panelRef}
        id={panelId}
        className={styles.panel}
        role="group"
        aria-label={card.title}
        aria-hidden={open ? undefined : true}
      >
        <div ref={innerRef} className={styles.inner}>
          {total || saving.length ? (
            <ul className={styles.list} role="list">
              {card.rows.map((row) => (
                <Row key={row.key} row={row} byline={bylineOf(row)} onTick={onTick} />
              ))}
              {saving.map((s) => (
                <li key={`saving-${s.key}`} className={styles.item} aria-busy="true" data-saving="">
                  <span className={`${styles.row} ${styles.saving}`}>
                    <span className={styles.spinner} aria-hidden="true" />
                    <span className={styles.text}>
                      <span className={styles.title}>{s.title}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : onAdd ? null : (
            <p className={styles.empty}>No tasks on this visit.</p>
          )}
          {!onAdd ? null : draft ? (
            <div className={styles.add} data-drafting="">
              <PlusCircle />
              <DraftField
                key={draft.key}
                fieldRef={fieldRef}
                initial={draft.text}
                onSave={(title) => save(title, false)}
                onEnd={endDraft}
              />
            </div>
          ) : waiting ? null : (
            <button
              ref={addRef}
              type="button"
              className={styles.add}
              data-add-task={card.key}
              aria-label={`Add Task to ${card.title}`}
              onClick={startDraft}
            >
              <PlusCircle />
              <span className={styles.addLabel}>Add Task</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The tint plus at the start of Add Task, in line with the checkboxes. */
function PlusCircle() {
  return (
    <svg className={styles.plus} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The new task's name, typed where Add Task was. Enter adds it and empties the field for the
 * next one, keeping the keyboard up (Enter with nothing typed closes it); leaving the field
 * adds what is there; Escape drops it.
 */
function DraftField({
  fieldRef,
  initial,
  onSave,
  onEnd,
}: {
  fieldRef: RefObject<HTMLTextAreaElement>;
  initial: string;
  onSave(title: string): void;
  onEnd(how: 'enter' | 'blur' | 'escape', text: string): void;
}) {
  const [text, setText] = useState(initial);
  const ended = useRef(false);
  const end = (how: 'enter' | 'blur' | 'escape') => {
    if (ended.current) return;
    ended.current = true;
    onEnd(how, text);
  };
  return (
    <AutoGrowTextarea
      ref={fieldRef}
      className={styles.draft}
      data-draft-input=""
      aria-label="Task name"
      placeholder={HOUSEKEEPING_NEW_TASK}
      maxLength={TEXT_LIMITS.housekeepingTask}
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => end('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!text.trim()) end('enter');
          else {
            onSave(text.trim());
            setText('');
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          end('escape');
        }
      }}
    />
  );
}

function Row({ row, byline, onTick }: { row: ChecklistRow; byline: string | null; onTick: ChecklistProps['onTick'] }) {
  const titleId = useId();
  const bylineId = useId();
  return (
    <li className={styles.item}>
      <label className={styles.row} data-done={row.done || undefined}>
        <input
          type="checkbox"
          className={styles.box}
          checked={row.done}
          aria-labelledby={titleId}
          aria-describedby={byline ? bylineId : undefined}
          onChange={(e) => onTick(row, e.currentTarget.checked)}
        />
        <span className={styles.circle} aria-hidden="true">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
        <span className={styles.text}>
          <span id={titleId} className={styles.title}>
            {row.title}
          </span>
          {byline ? (
            <span id={bylineId} className={styles.byline}>
              <EmojiText text={byline} />
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
