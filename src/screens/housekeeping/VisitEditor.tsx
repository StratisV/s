import { useEffect, useId, useRef } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import {
  areaChecklists,
  areaHeadingLabel,
  doneByline,
  isRecorded,
  matchesTarget,
  nameKey,
  sectionNameFor,
  sectionsNamed,
  visitByline,
  visitOn,
  type AreaChecklist,
  type ChecklistRow,
} from '../../lib/logic/housekeeping';
import type { HousekeepingVisitTask, ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { EmojiText } from '../../ui/EmojiText';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { Checklist } from './Checklist';
import { PriceField } from './PriceField';
import { NotSaved, SavedFlag } from './SaveStatus';
import { useSavedFlash, useSavedText } from './useSavedText';
import styles from './Housekeeping.module.css';

interface VisitEditorProps {
  /** The day (household time zone). Mount one per day (key it by date). */
  date: ISODate;
  /** The checklist's name: "Tasks today", "Tasks on Thursday 1 October". */
  legend: string;
  /**
   * For a day other than today, its name ("Thursday 1 October"): the comments and the price
   * are named with it, so they can be told from today's (VoiceOver's form controls list).
   */
  dayName?: string;
  /** Says what was saved, politely (the screen's live region). */
  announce(text: string): void;
  /** Opens the task list sheet (offered when today has no tasks), from the button pressed. */
  onEditTasks?(opener: HTMLElement): void;
}

export const NOT_STARTED = "Not started yet. Ticking a task starts today's visit.";
/** Today, with no tasks on the list to tick. */
export const NOT_STARTED_NO_TASKS = "Not started yet. Comments or a price start today's visit.";
/** A visit on another day with nothing ticked, no comments and no price (isRecorded()). */
export const NOTHING_RECORDED = 'Nothing recorded yet.';

/**
 * One day's visit, editable (everyone edits everything): the checklist (area by area),
 * comments, the price for the day, and who recorded it. A day with no visit yet shows the
 * task list unticked; the first tick (or comments, or a price) records the visit. Today, each
 * card ends with Add Task: a task added to an area goes in the section named after it, made
 * first when there is none. Comments and the price say "✓ Saved" for a moment when saved, and
 * keep what was typed with "Not saved. Try again" when a save fails. Its "Comments" heading is
 * an h3, under the day's h2 (Today, or the date).
 */
export function VisitEditor({ date, legend, dayName, announce, onEditTasks }: VisitEditorProps) {
  const {
    data,
    today,
    setHousekeepingTaskDone,
    saveHousekeepingVisit,
    createHousekeepingSection,
    createHousekeepingTask,
  } = useHousehold();
  const housekeeping = data.housekeeping;
  const { members } = data;
  const timeZone = data.household.timezone;
  const visit = visitOn(housekeeping.visits, date);
  const cards = areaChecklists(housekeeping, data.areas, date);
  const rows = cards.flatMap((card) => card.rows);
  const past = date !== today;
  const now = new Date();
  const commentsId = useId();
  const [priceSaved, flashPriceSaved] = useSavedFlash();

  const comments = useSavedText(visit?.comments ?? '', (text) =>
    saveHousekeepingVisit(date, { comments: text }).then(() => announce('Saved')),
  );

  const tick = (row: ChecklistRow, done: boolean) => {
    // The last one of a card ticked: the card is all done, and is read out as such.
    const card = cards.find((c) => c.rows.some((r) => r.key === row.key));
    const finishes = done && !!card && card.done === card.rows.length - 1;
    const said = `${row.title} ${done ? 'done' : 'not done'}`;
    void setHousekeepingTaskDone(date, row.target, done)
      .then(() => {
        const all = card?.rows.length ?? 0;
        announce(finishes && card ? `${said}. ${areaHeadingLabel(card.title, all, all, past)}` : said);
      })
      .catch(() => {});
  };

  // ── Adding a task to a card (today) ─────────────────────
  // An area's tasks are the section named after it (sectionsNamed()): the first task added to
  // an area makes that section, once, however fast the next ones follow.
  const sections = useRef(housekeeping.sections);
  sections.current = housekeeping.sections;
  const making = useRef(new Map<string, Promise<string>>());
  useEffect(() => {
    // Shown on the list now: the next task goes straight in.
    for (const key of making.current.keys()) {
      if (housekeeping.sections.some((s) => nameKey(s.title) === key)) making.current.delete(key);
    }
  });

  const sectionFor = (card: AreaChecklist): Promise<string | null> => {
    if (card.kind === 'home') return Promise.resolve(null);
    const live = sectionsNamed(sections.current, card.title)[0];
    if (live) return Promise.resolve(live.id);
    const key = nameKey(card.title);
    let pending = making.current.get(key);
    if (!pending) {
      pending = createHousekeepingSection(sectionNameFor(card.title)).then((s) => s.id);
      making.current.set(key, pending);
      pending.catch(() => making.current.delete(key));
    }
    return pending;
  };

  const addTask = async (card: AreaChecklist, title: string) => {
    const sectionId = await sectionFor(card);
    await createHousekeepingTask(title, sectionId);
    announce(`${title} added to ${card.title}`);
  };

  const bylineOf = (row: ChecklistRow): string | null => {
    if (!row.done) return null;
    const stored = visit?.tasks.find((t) => matchesTarget(t, row.target));
    const task: HousekeepingVisitTask = stored ?? {
      id: row.key,
      visit_id: visit?.id ?? '',
      household_id: data.household.id,
      task_id: 'taskId' in row.target ? row.target.taskId : null,
      title: row.title,
      section_id: null,
      section_title: '',
      position: 0,
      done: row.done,
      done_by: row.doneBy,
      done_at: row.doneAt,
    };
    return doneByline(task, date, members, timeZone, now);
  };

  // Who recorded it; or, while nothing is recorded, how it starts.
  const byline =
    visit && isRecorded(visit)
      ? visitByline(visit, members, timeZone, now)
      : date === today
        ? rows.length
          ? NOT_STARTED
          : NOT_STARTED_NO_TASKS
        : visit
          ? NOTHING_RECORDED
          : null;

  return (
    <div>
      {cards.length ? (
        <Checklist
          legend={legend}
          cards={cards}
          past={past}
          householdId={data.household.id}
          bylineOf={bylineOf}
          onTick={tick}
          onAdd={past ? undefined : addTask}
        />
      ) : date === today ? (
        <div className={styles.card}>
          <p className={styles.emptyText}>No tasks yet.</p>
          {onEditTasks ? (
            <button type="button" className={styles.cardButton} onClick={(e) => onEditTasks(e.currentTarget)}>
              Add tasks
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.card}>
          <p className={styles.emptyText}>No tasks on this visit.</p>
        </div>
      )}

      <div className={styles.subheaderRow}>
        <h3 id={commentsId} className={styles.subheader}>
          Comments
        </h3>
        {comments.state === 'saved' ? (
          <span className={styles.headerStatus}>
            <SavedFlag />
          </span>
        ) : null}
      </div>
      <div className={styles.card}>
        <AutoGrowTextarea
          className={styles.textField}
          value={comments.value}
          onChange={(e) => comments.onChange(e.target.value)}
          onFocus={comments.onFocus}
          onBlur={comments.onBlur}
          aria-labelledby={dayName ? undefined : commentsId}
          aria-label={dayName ? `Comments, ${dayName}` : undefined}
          placeholder="Anything to mention, e.g. we're out of bin bags"
          maxLength={TEXT_LIMITS.housekeepingComments}
          autoCapitalize="sentences"
        />
      </div>
      {comments.state === 'failed' ? <NotSaved what="the comments" onRetry={comments.retry} /> : null}

      <div className={styles.gap} />
      <PriceField
        stored={visit?.price_pence ?? null}
        label={dayName ? `Price for the day, ${dayName}` : 'Price for the day'}
        onSave={(price_pence) =>
          saveHousekeepingVisit(date, { price_pence }).then(() => {
            announce('Saved');
            flashPriceSaved();
          })
        }
      />

      {byline ? (
        <p className={styles.caption} data-visit-caption="">
          {priceSaved ? (
            <span className={styles.savedLead} aria-hidden="true">
              <SavedFlag />
              {' ·'}
            </span>
          ) : null}
          <EmojiText text={byline} />
        </p>
      ) : null}
    </div>
  );
}
