import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { GOALS_PER_WEEK_MAX, TEXT_LIMITS } from '../../lib/constants';
import { longDay } from '../../lib/logic/dates';
import {
  bringOverLabel,
  doneLine,
  firstName,
  goalsOf,
  progressLine,
  shiftWeek,
  toBringOver,
  weekLabel,
  weeksFromNow,
  weekStart,
} from '../../lib/logic/goals';
import type { Goal, ISODate, Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { useConfetti } from '../../ui/Confetti';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GripIcon,
  PencilIcon,
  PlusCircleIcon,
  ShareIcon,
  TrashIcon,
} from '../../ui/icons';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Screen } from '../../ui/Screen';
import { useGroupedReorder, type GroupedReorder } from '../../ui/useReorder';
import { ReadOnlyLine } from '../home/HomeScreen';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { InlineText } from '../profile/InlineText';
import { GoalsShareSheet } from './GoalsShareSheet';
import { BringOverIcon, LinkIcon, NobodyIcon } from './icons';
import styles from './Goals.module.css';

/** A new goal being typed where Add a Goal was, for the week it was opened on. */
interface Draft {
  key: number;
  week: ISODate;
  /** What the field starts with: '' for a new one, the title again after a save that failed. */
  text: string;
}

/** A new goal being saved: its row shows the title until the stored goal arrives. */
interface Saving {
  key: number;
  week: ISODate;
  title: string;
}

/** How a draft ended: Enter (and another), leaving the field, or Escape. */
type DraftEnd = 'enter' | 'blur' | 'escape';

/** The one group of the week's reorder. */
const WEEK = 'week';

/** How long a goal its menu just moved stays lit up where it landed. */
const MOVED_MS = 1400;

/**
 * Goals for the week (docs/ARCHITECTURE.md "Goals for the week"), the second tab: the
 * household's shared promise for the week. It opens on this week (Monday to Sunday, household
 * time zone), with arrows to the weeks before and after, how much is done, and Share (a public
 * link, GoalsShareSheet). One card holds the week: each goal with its tick (who ticked it and
 * when), its title (renamed in place), who is on it (a tap chooses), its "…" menu (Rename,
 * Move Up, Move Down, Delete Goal) and its grip (drag, or the arrow keys); then, on an empty
 * this week with unfinished goals last week, Bring over; then Add a Goal. Anyone at home can do
 * all of it, in any week.
 */
export function GoalsScreen({ onOpenProfile }: { onOpenProfile(): void }) {
  const { data, me, today, readOnly, addGoal, bringOverGoals, moveGoal, deleteGoal } = useHousehold();
  const [offset, setOffset] = useState(0);
  const thisWeek = weekStart(today);
  const week = shiftWeek(thisWeek, offset);
  const goals = useMemo(() => goalsOf(data.goals.list, week), [data.goals.list, week]);
  const carry = useMemo(
    () => (offset === 0 && goals.length === 0 ? toBringOver(data.goals.list, week) : []),
    [offset, goals.length, data.goals.list, week],
  );
  const weekId = useId();
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    scrollRef.current = rootRef.current?.closest<HTMLElement>('[data-screen-scroll]') ?? null;
  }, []);

  const [shareOpen, setShareOpen] = useState(false);
  const shareOpener = useRef<HTMLElement | null>(null);
  const openShare = (e: ReactMouseEvent<HTMLElement>) => {
    shareOpener.current = e.currentTarget;
    setShareOpen(true);
  };

  // ── Adding ───────────────────────────────────────────────

  const [draft, setDraft] = useState<Draft | null>(null);
  /** The draft open now, for the handlers (set as it opens and ends, before React renders). */
  const draftRef = useRef<Draft | null>(null);
  const [saving, setSaving] = useState<Saving[]>([]);
  const keys = useRef(0);
  const savingHere = saving.filter((s) => s.week === week);
  const full = goals.length + savingHere.length >= GOALS_PER_WEEK_MAX;

  const save = (target: ISODate, title: string) => {
    const key = ++keys.current;
    setSaving((s) => [...s, { key, week: target, title }]);
    addGoal(target, title)
      .catch(() => {
        // Couldn't save (the toast says why): the title comes back in its field to try again,
        // when nothing else is being written there.
        if (draftRef.current) return;
        const back = { key: ++keys.current, week: target, text: title };
        draftRef.current = back;
        setDraft(back);
      })
      .finally(() => setSaving((s) => s.filter((x) => x.key !== key)));
  };

  /** Add a Goal: the row becomes the title's field at once, inside the tap, so iOS raises the keyboard. */
  const openDraft = (target: ISODate = week, text = '') => {
    const next = { key: ++keys.current, week: target, text };
    draftRef.current = next;
    flushSync(() => setDraft(next));
    listRef.current?.querySelector<HTMLTextAreaElement>('[data-goal-draft]')?.focus();
  };

  /** Ends the draft `key`: its title, if any, is saved; Enter opens another, for the next goal. */
  const finishDraft = (key: number, how: DraftEnd, text: string) => {
    const open = draftRef.current;
    if (!open || open.key !== key) return;
    draftRef.current = null;
    const title = how === 'escape' ? '' : text.trim();
    if (title) save(open.week, title);
    if (how === 'enter' && title && !full && open.week === week) {
      openDraft(open.week);
      return;
    }
    setDraft(null);
    if (how === 'enter' || how === 'escape') focusSoon('[data-add-goal]');
  };

  // Another week: a draft open for the one before is saved (or dropped, when empty) and closes.
  useEffect(() => {
    const open = draftRef.current;
    if (!open || open.week === week) return;
    const field = listRef.current?.querySelector<HTMLTextAreaElement>('[data-goal-draft]');
    finishDraft(open.key, 'blur', field?.value ?? open.text);
    // finishDraft reads only refs and the week; it runs when the week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  // ── Focus after a change ─────────────────────────────────

  const focusNext = useRef<string | null>(null);
  const applyFocus = useCallback(() => {
    const selector = focusNext.current;
    const el = selector ? rootRef.current?.querySelector<HTMLElement>(selector) : null;
    if (!selector || !el) return;
    focusNext.current = null;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(applyFocus);
  const focusSoon = (selector: string) => {
    focusNext.current = selector;
    requestAnimationFrame(applyFocus);
  };

  // ── Moving ───────────────────────────────────────────────

  const [moved, setMoved] = useState<string | null>(null);
  useEffect(() => {
    if (!moved) return;
    const timer = window.setTimeout(() => setMoved(null), MOVED_MS);
    return () => clearTimeout(timer);
  }, [moved]);
  const reorder = useGroupedReorder({
    scope: 'goals',
    groups: [{ id: WEEK, name: null, ids: goals.map((g) => g.id) }],
    nameOf: (id) => goals.find((g) => g.id === id)?.title ?? '',
    rootRef: listRef,
    scrollRef: scrollRef as RefObject<HTMLElement>,
    // One goal and where it goes: a move made on another phone meanwhile stands.
    onMove: (id, _group, index) => moveGoal(id, index),
  });
  const moveBy = (goal: Goal, delta: number) => {
    const at = goals.findIndex((g) => g.id === goal.id);
    focusNext.current = `[data-goal-menu="${goal.id}"]`;
    reorder.move(goal.id, WEEK, at + delta);
    setMoved(goal.id);
  };

  // ── Deleting ─────────────────────────────────────────────

  const [confirm, setConfirm] = useState<Goal | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmDelete = () => {
    setConfirmOpen(false);
    if (!confirm) return;
    const at = goals.findIndex((g) => g.id === confirm.id);
    const next = goals[at + 1] ?? goals[at - 1];
    void deleteGoal(confirm.id).catch(() => {});
    // Keyboard focus stays nearby: the next goal's "…", else Add a Goal.
    focusSoon(next ? `[data-goal-menu="${next.id}"]` : '[data-add-goal]');
  };

  // ── Bring over ───────────────────────────────────────────

  const [bringing, setBringing] = useState(false);
  const bringOver = () => {
    if (bringing) return;
    setBringing(true);
    bringOverGoals(week)
      .then((added) => {
        if (added.length) focusSoon(`[data-goal-tick="${added[0].id}"]`);
      })
      .catch(() => {})
      .finally(() => setBringing(false));
  };

  const progress = progressLine(goals, week, today);
  const n = weeksFromNow(week, today);
  const empty = goals.length === 0 && savingHere.length === 0;
  const prompt = empty && n >= 0 ? (n === 0 ? 'What would make it a good week at home?' : 'Plan ahead: what should get done that week?') : null;

  return (
    <Screen
      label="Goals for the week"
      title="Goals for the week"
      eyebrow={<time dateTime={today}>{longDay(today)}</time>}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
      withAdd={false}
    >
      <div ref={rootRef} className={styles.root}>
        <div className={styles.summaryRow}>
          <p className={styles.progress} data-goals-progress="" aria-live="polite">
            {progress}
          </p>
          <button type="button" className={styles.share} onClick={openShare} data-goals-share="">
            <ShareIcon size={17} strokeWidth={2} />
            Share
          </button>
        </div>
        {readOnly ? <ReadOnlyLine /> : null}

        <section className={styles.card} aria-labelledby={weekId} data-goals-week={week}>
          <div className={styles.weekBar}>
            <button type="button" className={styles.weekNav} aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>
              <ChevronLeftIcon size={20} />
            </button>
            <div className={styles.weekHeading}>
              <h2 id={weekId} className={styles.weekName} aria-live="polite">
                {weekLabel(week, today)}
              </h2>
              {offset !== 0 ? (
                <button type="button" className={styles.thisWeek} onClick={() => setOffset(0)}>
                  This Week
                </button>
              ) : null}
            </div>
            <button type="button" className={styles.weekNav} aria-label="Next week" onClick={() => setOffset((o) => o + 1)}>
              <ChevronRightIcon size={20} strokeWidth={2.6} />
            </button>
          </div>

          <div
            ref={listRef}
            className={styles.lists}
            data-reordering={reorder.dragging || undefined}
            // A tap on a button while a goal is being typed: the field keeps focus for the press,
            // so the row saving it can't push the list under the finger and lose the tap.
            onMouseDown={(e) => {
              if (draftRef.current && (e.target as Element).closest?.('button')) e.preventDefault();
            }}
          >
            {prompt ? <p className={styles.prompt}>{prompt}</p> : null}
            <ul className={styles.list} aria-labelledby={weekId} data-goals-list="">
              {goals.map((goal, index) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  index={index}
                  count={goals.length}
                  members={data.members}
                  timeZone={data.household.timezone}
                  weekGoals={goals}
                  reorder={reorder}
                  hintId={hintId}
                  moved={moved === goal.id}
                  onMove={moveBy}
                  onDelete={(g) => {
                    setConfirm(g);
                    setConfirmOpen(true);
                  }}
                />
              ))}
              {savingHere.map((s) => (
                <li key={`saving-${s.key}`} className={`${styles.row} ${styles.saving}`} aria-busy="true">
                  <span className={styles.tickSlot} aria-hidden="true">
                    <span className={styles.ring} />
                  </span>
                  <div className={styles.main}>
                    <span className={styles.savingTitle}>{s.title}</span>
                  </div>
                  <span className={styles.spinner} aria-hidden="true" />
                </li>
              ))}
            </ul>

            {carry.length && !savingHere.length ? (
              <button type="button" className={styles.bringOver} onClick={bringOver} aria-busy={bringing || undefined} data-bring-over="">
                <BringOverIcon size={22} />
                <span className={styles.addLabel}>{bringOverLabel(carry.length)}</span>
              </button>
            ) : null}

            {draft && draft.week === week ? (
              <div className={styles.add} data-drafting="" {...reorder.endProps(WEEK)}>
                <PlusCircleIcon size={22} />
                <DraftField key={draft.key} initial={draft.text} onFinish={(how, text) => finishDraft(draft.key, how, text)} />
              </div>
            ) : (
              <button
                type="button"
                className={styles.add}
                data-add-goal=""
                disabled={full}
                onClick={() => openDraft()}
                {...reorder.endProps(WEEK)}
              >
                <PlusCircleIcon size={22} />
                <span className={styles.addLabel}>Add a Goal</span>
              </button>
            )}
          </div>
        </section>

        {full ? <p className={styles.caption}>A week has {GOALS_PER_WEEK_MAX} goals at most.</p> : null}
        {data.goals.link ? (
          <button type="button" className={styles.linkLine} onClick={openShare} data-goals-link-on="">
            <LinkIcon size={17} />
            <span>Shared with a link. Anyone with it can see this week’s goals.</span>
          </button>
        ) : empty && n === 0 ? (
          <p className={styles.caption}>Anyone at home can add a goal, tick it off or change it.</p>
        ) : null}

        <span id={hintId} className="visually-hidden">
          Drag, or use the up and down arrow keys, to move this goal.
        </span>
        <div className="visually-hidden" aria-live="polite" data-goal-moves="">
          {reorder.announcement}
        </div>
      </div>

      <ActionSheet
        open={confirmOpen}
        title={confirm ? `Delete ${confirm.title}?` : undefined}
        message="It goes for everyone at home."
        actions={[{ label: 'Delete Goal', destructive: true, onSelect: confirmDelete }]}
        onCancel={() => setConfirmOpen(false)}
      />
      <GoalsShareSheet
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
          const opener = shareOpener.current;
          if (opener?.isConnected) opener.focus({ preventScroll: true });
        }}
      />
    </Screen>
  );
}

interface GoalRowProps {
  goal: Goal;
  index: number;
  count: number;
  members: Member[];
  timeZone: string;
  /** The week's goals, to tell when this tick finishes the week. */
  weekGoals: Goal[];
  reorder: GroupedReorder;
  hintId: string;
  /** Just moved by its menu: lit up for a moment. */
  moved: boolean;
  onMove(goal: Goal, delta: number): void;
  onDelete(goal: Goal): void;
}

/**
 * One goal: its tick (a checkbox: who ticked it and when under the title), its title (renamed in
 * place), who is on it (a tap chooses, from everyone at home, or no one), its "…" menu and its
 * grip. Ticking the last open goal of a week sets off the hedgehogs and ducks.
 */
function GoalRow({ goal, index, count, members, timeZone, weekGoals, reorder, hintId, moved, onMove, onDelete }: GoalRowProps) {
  const { renameGoal, setGoalPerson, setGoalDone } = useHousehold();
  const fire = useConfetti();
  const titleRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const person = goal.member_id ? members.find((m) => m.id === goal.member_id) : undefined;
  const done = doneLine(goal, members, timeZone, new Date());

  const tick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const next = !goal.done;
    if (next) {
      navigator.vibrate?.(10);
      // The last one of the week: a small celebration.
      if (weekGoals.every((g) => g.id === goal.id || g.done)) fire(e.currentTarget);
    }
    void setGoalDone(goal.id, next).catch(() => {});
  };

  const people: MenuItem[] = [
    {
      key: 'nobody',
      label: 'No one',
      lead: <NobodyIcon size={20} />,
      checked: goal.member_id === null,
      onSelect: () => void setGoalPerson(goal.id, null).catch(() => {}),
    },
    ...members.map((m, i) => ({
      key: m.id,
      label: m.name,
      lead: <span className={styles.menuEmoji}>{m.emoji}</span>,
      checked: goal.member_id === m.id,
      groupStart: i === 0,
      onSelect: () => void setGoalPerson(goal.id, m.id).catch(() => {}),
    })),
  ];

  const actions: MenuItem[] = [
    {
      key: 'rename',
      label: 'Rename',
      icon: <PencilIcon size={20} />,
      // Focused here, inside the tap (Menu runs this in its click), so iOS raises the keyboard.
      onSelect: () => {
        titleRef.current?.focus();
        titleRef.current?.select();
      },
    },
    ...(index > 0 ? [{ key: 'up', label: 'Move Up', icon: <ArrowUpIcon size={20} />, onSelect: () => onMove(goal, -1) }] : []),
    ...(index < count - 1 ? [{ key: 'down', label: 'Move Down', icon: <ArrowDownIcon size={20} />, onSelect: () => onMove(goal, 1) }] : []),
    {
      key: 'delete',
      label: 'Delete Goal',
      icon: <TrashIcon size={20} />,
      destructive: true,
      groupStart: true,
      onSelect: () => onDelete(goal),
    },
  ];

  return (
    <li
      className={styles.row}
      data-done={goal.done || undefined}
      data-goal-id={goal.id}
      data-moved={moved || undefined}
      {...reorder.itemProps(goal.id)}
    >
      <span className={styles.tickSlot}>
        <button
          type="button"
          role="checkbox"
          aria-checked={goal.done}
          aria-label={goal.title}
          className={styles.tick}
          data-goal-tick={goal.id}
          onClick={tick}
        >
          <span className={styles.ring}>
            <CheckIcon className={styles.check} size={15} strokeWidth={3.2} />
          </span>
        </button>
      </span>
      <div className={styles.main}>
        <InlineText
          ref={titleRef}
          multiline
          className={styles.title}
          data-goal-title={goal.id}
          value={goal.title}
          aria-label="Goal"
          autoCapitalize="sentences"
          maxLength={TEXT_LIMITS.goalTitle}
          onCommit={(title) => void renameGoal(goal.id, title).catch(() => {})}
        />
        <div className={styles.meta}>
          <Menu label="Who’s on it" title="Who’s on it" items={people}>
            {({ ref, ...trigger }) => (
              <button
                ref={ref}
                type="button"
                className={styles.person}
                data-goal-person={goal.id}
                data-nobody={person ? undefined : ''}
                aria-label={person ? `On it: ${person.name}. Change who is on ${goal.title}` : `Choose who is on ${goal.title}`}
                {...trigger}
              >
                {person ? (
                  <>
                    <span className={styles.personEmoji} aria-hidden="true">
                      {person.emoji}
                    </span>
                    <span>{firstName(person.name)}</span>
                  </>
                ) : (
                  <>
                    <NobodyIcon size={17} />
                    <span>No one yet</span>
                  </>
                )}
              </button>
            )}
          </Menu>
          {done ? (
            <span className={styles.done} data-goal-done="">
              {done}
            </span>
          ) : null}
        </div>
      </div>
      <Menu label={`${goal.title} options`} items={actions}>
        {({ ref, ...trigger }) => (
          <button ref={ref} type="button" className={styles.more} data-goal-menu={goal.id} aria-label={`${goal.title} options`} {...trigger}>
            <EllipsisIcon size={20} />
          </button>
        )}
      </Menu>
      <button
        type="button"
        className={styles.grip}
        aria-label={`Reorder ${goal.title}`}
        aria-describedby={hintId}
        {...reorder.gripProps(goal.id)}
      >
        <GripIcon size={22} />
      </button>
    </li>
  );
}

/**
 * A new goal's title, typed where Add a Goal was: it wraps as it grows; Enter makes the goal and
 * opens the next one; leaving it makes the goal with what is there (nothing typed adds nothing);
 * Escape drops it.
 */
function DraftField({ initial, onFinish }: { initial: string; onFinish(how: DraftEnd, text: string): void }) {
  const [text, setText] = useState(initial);
  return (
    <AutoGrowTextarea
      className={styles.draft}
      data-goal-draft=""
      aria-label="New goal"
      placeholder="New goal"
      maxLength={TEXT_LIMITS.goalTitle}
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="on"
      spellCheck
      enterKeyHint="next"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => onFinish('blur', text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onFinish('enter', text);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onFinish('escape', text);
        }
      }}
    />
  );
}
