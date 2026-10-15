import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { HOUSEKEEPING_NEW_SECTION, HOUSEKEEPING_NEW_TASK, HOUSEKEEPING_SECTIONS_MAX, TEXT_LIMITS } from '../../lib/constants';
import { taskListGroups } from '../../lib/logic/housekeeping';
import type { HousekeepingSection, HousekeepingTask } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import {
  AddSectionIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DashedSquareIcon,
  EllipsisIcon,
  GripIcon,
  MinusCircleIcon,
  PencilIcon,
  PlusCircleIcon,
  TrashIcon,
} from '../../ui/icons';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Sheet } from '../../ui/Sheet';
import { useGroupedReorder } from '../../ui/useReorder';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { InlineText } from '../profile/InlineText';
import list from '../profile/List.module.css';
import { SectionIcon } from './SectionIcon';
import styles from './TaskListSheet.module.css';

interface TaskListSheetProps {
  open: boolean;
  onClose(): void;
}

/** The group of the tasks in no section (a section's group is its id). */
const NONE = 'none';
/** The one group of the sections' own reorder, and an Add Section's draft. */
const SECTIONS = 'sections';

/** What the delete confirmation says happens to a section's tasks. */
export function deleteSectionMessage(tasks: number): string {
  const kept =
    tasks === 0 ? '' : tasks === 1 ? 'Its task moves to the top of the list. ' : `Its ${tasks} tasks move to the top of the list. `;
  return `${kept}Earlier visits keep this section.`;
}

/** A new task (in its group) or section (SECTIONS) being named: it is made once its name is in. */
interface Draft {
  key: number;
  group: string;
  /** What the field starts with: '' for a new one, the name again after a save that failed. */
  text: string;
}

/** A new task or section being saved: its row shows the name until the stored one arrives. */
interface Saving {
  key: number;
  group: string;
  title: string;
}

/** How a draft ended: Enter, leaving the field, Escape, or another Add tapped. */
type DraftEnd = 'enter' | 'blur' | 'escape' | 'switch';

/**
 * The household's housekeeping task list, edited in place in a page sheet. The tasks in no
 * section come first, in a card of their own (headed No Section once there are sections);
 * then a card per section, its drawing and name at the top (renamed in place), its "…" menu
 * (Rename, Move Up, Move Down, Delete Section) and its grip; then Add Section. Each card ends
 * with Add Task. Add Task and Add Section turn into the new name's field at once, inside the
 * tap, and the task or section is made once the name is in, with what was typed. A task is
 * renamed in place, deleted with the red minus (confirmed), moved by dragging its grip (within
 * its section or into another, or the arrow keys on it), or with Move to Section in its "…"
 * menu (there once there are sections). A section moves by its grip too, carried by its
 * header. Names wrap, so a long one reads in full. Today's visit follows the changes; earlier
 * visits keep their own list.
 *
 * App mounts it next to the stage (like the Item sheet), so the screen behind is pushed back.
 */
export function TaskListSheet({ open, onClose }: TaskListSheetProps) {
  return (
    <Sheet open={open} onRequestClose={onClose} label="Task list">
      <TaskListBody onClose={onClose} />
    </Sheet>
  );
}

function TaskListBody({ onClose }: { onClose(): void }) {
  const {
    data,
    createHousekeepingTask,
    renameHousekeepingTask,
    deleteHousekeepingTask,
    moveHousekeepingTask,
    createHousekeepingSection,
    renameHousekeepingSection,
    deleteHousekeepingSection,
    moveHousekeepingSection,
  } = useHousehold();
  const groups = taskListGroups(data.housekeeping);
  const sections = groups.flatMap((g) => (g.section ? [g.section] : []));
  const hasSections = sections.length > 0;
  const titleId = useId();
  const noneId = useId();
  const taskHintId = useId();
  const sectionHintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const [confirmTask, setConfirmTask] = useState<HousekeepingTask | null>(null);
  const [taskConfirmOpen, setTaskConfirmOpen] = useState(false);
  const [confirmSection, setConfirmSection] = useState<HousekeepingSection | null>(null);
  const [sectionConfirmOpen, setSectionConfirmOpen] = useState(false);
  /** A task its menu just moved: lit up for a moment where it landed. */
  const [moved, setMoved] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The draft open now, for the handlers (set as it opens and ends, before React renders). */
  const draftRef = useRef<Draft | null>(null);
  const [saving, setSaving] = useState<Saving[]>([]);
  const keys = useRef(0);
  /** The groups there are now (a failed save's name comes back only where it can show). */
  const groupIds = useRef(new Set<string>());
  groupIds.current = new Set([NONE, SECTIONS, ...sections.map((s) => s.id)]);

  const pendingSections = saving.filter((s) => s.group === SECTIONS).length + (draft?.group === SECTIONS ? 1 : 0);
  const full = sections.length + pendingSections >= HOUSEKEEPING_SECTIONS_MAX;

  const titleOf = (id: string) => data.housekeeping.tasks.find((t) => t.id === id)?.title ?? '';
  const tasks = useGroupedReorder({
    scope: 'tasks',
    groups: groups.map((g) => ({
      id: g.section?.id ?? NONE,
      name: g.section?.title ?? (hasSections ? 'No Section' : null),
      ids: g.tasks.map((t) => t.id),
    })),
    nameOf: titleOf,
    rootRef: listsRef,
    scrollRef,
    // One task and where it goes: a move made on another phone meanwhile stands.
    onMove: (id, group, index) => moveHousekeepingTask(id, group === NONE ? null : group, index),
  });
  const sectionMoves = useGroupedReorder({
    scope: 'sections',
    groups: [{ id: SECTIONS, name: null, ids: sections.map((s) => s.id) }],
    nameOf: (id) => sections.find((s) => s.id === id)?.title ?? '',
    rootRef: listsRef,
    scrollRef,
    onMove: (id, _group, index) => moveHousekeepingSection(id, index),
    liftSelector: '[data-section-head]',
    liftRadius: 20,
  });

  // Where focus goes once the lists show a change: a control found by its data attribute,
  // without scrolling the sheet (so a task moved by its menu leaves you where you were), or
  // brought into view when `reveal` (a section moved up or down).
  const focusNext = useRef<{ selector: string; reveal?: boolean } | null>(null);
  const applyFocus = useCallback(() => {
    const next = focusNext.current;
    const el = next ? listsRef.current?.querySelector<HTMLElement>(next.selector) : null;
    if (!next || !el) return;
    focusNext.current = null;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (next.reveal) el.scrollIntoView?.({ block: 'nearest' });
  }, []);
  useLayoutEffect(applyFocus);
  const focusSoon = (selector: string) => {
    focusNext.current = { selector };
    requestAnimationFrame(applyFocus);
  };

  useEffect(() => {
    if (!moved) return;
    const timer = window.setTimeout(() => setMoved(null), 1400);
    return () => clearTimeout(timer);
  }, [moved]);

  // ── Adding ───────────────────────────────────────────────

  const addButton = (group: string) => (group === SECTIONS ? '[data-add-section]' : `[data-add-task="${group}"]`);

  /** Makes the task or section with its name; its row shows the name until it is stored. */
  const save = (group: string, title: string) => {
    const key = ++keys.current;
    setSaving((s) => [...s, { key, group, title }]);
    const made = group === SECTIONS ? createHousekeepingSection(title) : createHousekeepingTask(title, group === NONE ? null : group);
    made
      .catch(() => {
        // Couldn't save (the toast says why): the name comes back in its field to try again,
        // where that can still show and nothing else is being written.
        if (draftRef.current || !groupIds.current.has(group)) return;
        const back = { key: ++keys.current, group, text: title };
        draftRef.current = back;
        setDraft(back);
      })
      .finally(() => setSaving((s) => s.filter((x) => x.key !== key)));
  };

  /** Ends the draft `key`: its name, if any, is saved; Escape drops it. */
  const finishDraft = (key: number, how: DraftEnd, text: string) => {
    const open = draftRef.current;
    if (!open || open.key !== key) return;
    draftRef.current = null;
    setDraft(null);
    const title = how === 'escape' ? '' : text.trim();
    if (title) save(open.group, title);
    // From the keyboard, back to the button it started from (Enter there adds another).
    if (how === 'enter' || how === 'escape') focusNext.current = { selector: addButton(open.group) };
  };

  /**
   * Add Task or Add Section: the row becomes the new name's field, shown and focused inside
   * the tap, so iOS raises the keyboard and every letter typed lands in it.
   */
  const openDraft = (group: string) => {
    const open = draftRef.current;
    if (open) {
      const field = listsRef.current?.querySelector<HTMLTextAreaElement>('[data-draft-input]');
      finishDraft(open.key, 'switch', field?.value ?? '');
    }
    const next = { key: ++keys.current, group, text: '' };
    draftRef.current = next;
    flushSync(() => setDraft(next));
    listsRef.current?.querySelector<HTMLTextAreaElement>('[data-draft-input]')?.focus();
  };

  // A tap on a button while a new name is being typed (Add Task in the next card, a task's
  // delete or "…"): the press leaves the name's field focused, and the name is saved as the
  // click starts (Add hands over to its own field; a grip leaves it open, to go on typing), so
  // the row saving it cannot push the list down under the finger between the press and the
  // click and lose the tap.
  const isButtonPress = (e: ReactMouseEvent) => !!draftRef.current && !!(e.target as Element).closest?.('button');
  const keepDraftFocus = (e: ReactMouseEvent) => {
    if (isButtonPress(e)) e.preventDefault();
  };
  const saveDraftFirst = (e: ReactMouseEvent) => {
    const open = draftRef.current;
    if (!open || !isButtonPress(e) || (e.target as Element).closest('[data-add-task], [data-add-section], [data-grip]')) return;
    const field = listsRef.current?.querySelector<HTMLTextAreaElement>('[data-draft-input]');
    flushSync(() => finishDraft(open.key, 'switch', field?.value ?? ''));
  };

  const draftField = (d: Draft, kind: 'task' | 'section', lead?: (text: string) => ReactNode) => (
    <DraftField
      key={d.key}
      initial={d.text}
      className={kind === 'task' ? styles.draftName : styles.draftSectionName}
      label={kind === 'task' ? 'Task name' : 'Section name'}
      placeholder={kind === 'task' ? HOUSEKEEPING_NEW_TASK : HOUSEKEEPING_NEW_SECTION}
      maxLength={kind === 'task' ? TEXT_LIMITS.housekeepingTask : TEXT_LIMITS.housekeepingSection}
      lead={lead}
      onFinish={(how, text) => finishDraft(d.key, how, text)}
    />
  );

  // ── Deleting ─────────────────────────────────────────────

  const confirmDeleteTask = () => {
    setTaskConfirmOpen(false);
    if (!confirmTask) return;
    const group = groups.find((g) => g.tasks.some((t) => t.id === confirmTask.id));
    const index = group?.tasks.findIndex((t) => t.id === confirmTask.id) ?? -1;
    const nextId = group?.tasks[index + 1]?.id ?? group?.tasks[index - 1]?.id;
    void deleteHousekeepingTask(confirmTask.id).catch(() => {});
    // Keep keyboard focus nearby: the next row's delete button, or its card's Add Task.
    focusSoon(nextId ? `[data-delete="${nextId}"]` : addButton(group?.section?.id ?? NONE));
  };

  const confirmDeleteSection = () => {
    setSectionConfirmOpen(false);
    if (!confirmSection) return;
    const index = sections.findIndex((s) => s.id === confirmSection.id);
    const next = sections[index + 1] ?? sections[index - 1];
    void deleteHousekeepingSection(confirmSection.id).catch(() => {});
    // The next section's "…", else the one before it, else Add Section.
    focusSoon(next ? `[data-section-menu="${next.id}"]` : '[data-add-section]');
  };
  const sectionTasks = confirmSection ? (groups.find((g) => g.section?.id === confirmSection.id)?.tasks.length ?? 0) : 0;

  // ── Menus ────────────────────────────────────────────────

  const moveTask = (task: HousekeepingTask, from: string, to: string) => {
    if (from === to) return;
    // Keep the place: focus stays in the card the task left (on the next task's "…", ready for
    // the next move, else its Add Task) and the sheet does not scroll; the move is announced
    // and the task lights up where it landed.
    const group = groups.find((g) => (g.section?.id ?? NONE) === from);
    const at = group?.tasks.findIndex((t) => t.id === task.id) ?? -1;
    const stay = group?.tasks[at + 1] ?? group?.tasks[at - 1];
    focusNext.current = { selector: stay ? `[data-task-menu="${stay.id}"]` : addButton(from) };
    tasks.move(task.id, to);
    setMoved(task.id);
  };
  const moveMenu = (task: HousekeepingTask, group: string): MenuItem[] => [
    {
      key: NONE,
      label: 'No Section',
      lead: <DashedSquareIcon size={20} />,
      checked: group === NONE,
      onSelect: () => moveTask(task, group, NONE),
    },
    ...sections.map((section, i) => ({
      key: section.id,
      label: section.title,
      lead: <SectionIcon name={section.title} size={20} />,
      checked: group === section.id,
      groupStart: i === 0,
      onSelect: () => moveTask(task, group, section.id),
    })),
  ];

  const moveSection = (section: HousekeepingSection, index: number) => {
    focusNext.current = { selector: `[data-section-menu="${section.id}"]`, reveal: true };
    sectionMoves.move(section.id, SECTIONS, index);
  };
  const sectionMenu = (section: HousekeepingSection, index: number): MenuItem[] => [
    {
      key: 'rename',
      label: 'Rename',
      icon: <PencilIcon size={20} />,
      // Focused here, inside the tap (Menu runs this in its click), so iOS raises the keyboard.
      onSelect: () => {
        const field = listsRef.current?.querySelector<HTMLTextAreaElement>(`[data-section-input="${section.id}"]`);
        field?.focus();
        field?.select();
      },
    },
    ...(index > 0
      ? [{ key: 'up', label: 'Move Up', icon: <ArrowUpIcon size={20} />, onSelect: () => moveSection(section, index - 1) }]
      : []),
    ...(index < sections.length - 1
      ? [{ key: 'down', label: 'Move Down', icon: <ArrowDownIcon size={20} />, onSelect: () => moveSection(section, index + 1) }]
      : []),
    {
      key: 'delete',
      label: 'Delete Section',
      icon: <TrashIcon size={20} />,
      destructive: true,
      groupStart: true,
      onSelect: () => {
        setConfirmSection(section);
        setSectionConfirmOpen(true);
      },
    },
  ];

  // ── Rendering ────────────────────────────────────────────

  const taskRow = (task: HousekeepingTask, group: string) => (
    <li key={task.id} className={styles.row} data-moved={moved === task.id || undefined} {...tasks.itemProps(task.id)}>
      <button
        type="button"
        className={styles.delete}
        data-delete={task.id}
        aria-label={`Delete ${task.title}`}
        onClick={() => {
          setConfirmTask(task);
          setTaskConfirmOpen(true);
        }}
      >
        <MinusCircleIcon size={22} />
      </button>
      <div className={styles.main}>
        <InlineText
          multiline
          className={styles.name}
          data-task-input={task.id}
          value={task.title}
          aria-label="Task name"
          autoCapitalize="sentences"
          maxLength={TEXT_LIMITS.housekeepingTask}
          onCommit={(title) => void renameHousekeepingTask(task.id, title).catch(() => {})}
        />
        {hasSections ? (
          <Menu label="Move to Section" title="Move to Section" items={moveMenu(task, group)}>
            {({ ref, ...trigger }) => (
              <button
                ref={ref}
                type="button"
                className={styles.more}
                data-task-menu={task.id}
                aria-label={`Move ${task.title} to a section`}
                {...trigger}
              >
                <EllipsisIcon size={20} />
              </button>
            )}
          </Menu>
        ) : null}
        <button
          type="button"
          className={styles.grip}
          aria-label={`Reorder ${task.title}`}
          aria-describedby={taskHintId}
          {...tasks.gripProps(task.id)}
        >
          <GripIcon size={22} />
        </button>
      </div>
    </li>
  );

  /** A new task saving: its name where it will be, and a quiet spinner. */
  const savingRow = (s: Saving) => (
    <li key={`saving-${s.key}`} className={`${styles.row} ${styles.saving}`} aria-busy="true">
      <span className={styles.delete} aria-hidden="true" />
      <div className={styles.main}>
        <span className={styles.savingName}>{s.title}</span>
        <span className={styles.spinner} aria-hidden="true" />
      </div>
    </li>
  );

  const addTaskRow = (group: string, name: string, first: boolean) =>
    draft?.group === group ? (
      <div className={styles.add} data-first={first || undefined} data-drafting="" {...tasks.endProps(group)}>
        <PlusCircleIcon size={22} />
        {draftField(draft, 'task')}
      </div>
    ) : (
      <button
        type="button"
        className={styles.add}
        data-first={first || undefined}
        data-add-task={group}
        aria-label={hasSections ? `Add Task to ${name}` : undefined}
        onClick={() => openDraft(group)}
        {...tasks.endProps(group)}
      >
        <PlusCircleIcon size={22} />
        <span className={styles.addLabel}>Add Task</span>
      </button>
    );

  /** A group's rows: its tasks, then any of its new tasks still saving. */
  const rows = (group: string, groupTasks: HousekeepingTask[]) => [
    ...groupTasks.map((task) => taskRow(task, group)),
    ...saving.filter((s) => s.group === group).map(savingRow),
  ];
  const isEmpty = (group: string, groupTasks: HousekeepingTask[]) =>
    groupTasks.length === 0 && !saving.some((s) => s.group === group);

  const loose = groups[0];

  return (
    <div className={styles.root}>
      <div className={styles.nav} data-sheet-handle>
        <span />
        <h2 id={titleId} className={styles.title}>
          Task list
        </h2>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </div>
      <div ref={scrollRef} className={styles.body} data-sheet-scroll>
        <div
          ref={listsRef}
          className={styles.lists}
          data-reordering={tasks.dragging ? 'tasks' : sectionMoves.dragging ? 'sections' : undefined}
          onMouseDown={keepDraftFocus}
          onClickCapture={saveDraftFirst}
        >
          {/* The tasks in no section: first; headed No Section once there are sections. */}
          <div
            className={`${styles.card} ${hasSections ? styles.sectionCard : ''}`}
            role={hasSections ? 'group' : undefined}
            aria-labelledby={hasSections ? noneId : undefined}
          >
            {hasSections ? (
              <div className={styles.head} data-none-head="">
                <span className={`${styles.glyph} ${styles.noneGlyph}`} aria-hidden="true">
                  <DashedSquareIcon size={19} />
                </span>
                <span id={noneId} className={styles.noneName}>
                  No Section
                </span>
              </div>
            ) : null}
            <ul className={styles.list} aria-labelledby={hasSections ? undefined : titleId}>
              {rows(NONE, loose.tasks)}
            </ul>
            {addTaskRow(NONE, 'No Section', isEmpty(NONE, loose.tasks))}
          </div>

          {sections.map((section, index) => {
            const group = groups[index + 1];
            return (
              <div key={section.id} className={styles.sectionItem} {...sectionMoves.itemProps(section.id)}>
                <div className={`${styles.card} ${styles.sectionCard}`} role="group" aria-label={section.title}>
                  <div className={styles.head} data-section-head="">
                    <span className={styles.glyph} aria-hidden="true">
                      <SectionIcon name={section.title} size={19} />
                    </span>
                    <InlineText
                      multiline
                      className={styles.sectionName}
                      data-section-input={section.id}
                      value={section.title}
                      aria-label="Section name"
                      autoCapitalize="sentences"
                      maxLength={TEXT_LIMITS.housekeepingSection}
                      onCommit={(title) => void renameHousekeepingSection(section.id, title).catch(() => {})}
                    />
                    <Menu label={`${section.title} options`} items={sectionMenu(section, index)}>
                      {({ ref, ...trigger }) => (
                        <button
                          ref={ref}
                          type="button"
                          className={styles.more}
                          data-section-menu={section.id}
                          aria-label={`${section.title} options`}
                          {...trigger}
                        >
                          <EllipsisIcon size={20} />
                        </button>
                      )}
                    </Menu>
                    <button
                      type="button"
                      className={styles.grip}
                      aria-label={`Reorder ${section.title} section`}
                      aria-describedby={sectionHintId}
                      {...sectionMoves.gripProps(section.id)}
                    >
                      <GripIcon size={22} />
                    </button>
                  </div>
                  <ul className={styles.list}>{rows(section.id, group.tasks)}</ul>
                  {addTaskRow(section.id, section.title, isEmpty(section.id, group.tasks))}
                </div>
              </div>
            );
          })}

          {/* New sections still saving: their names where they will be. */}
          {saving
            .filter((s) => s.group === SECTIONS)
            .map((s) => (
              <div key={`saving-${s.key}`} className={styles.sectionItem} aria-busy="true">
                <div className={`${styles.card} ${styles.sectionCard} ${styles.saving}`}>
                  <div className={styles.head}>
                    <span className={styles.glyph} aria-hidden="true">
                      <SectionIcon name={s.title} size={19} />
                    </span>
                    <span className={styles.savingSectionName}>{s.title}</span>
                    <span className={styles.spinner} aria-hidden="true" />
                  </div>
                </div>
              </div>
            ))}

          <div className={styles.addSectionItem} {...sectionMoves.endProps(SECTIONS)}>
            <div className={styles.card}>
              {draft?.group === SECTIONS ? (
                // A section's header being written: its drawing follows the name typed.
                <div className={`${styles.head} ${styles.draftHead}`} data-drafting="">
                  {draftField(draft, 'section', (text) => (
                    <span className={styles.glyph} aria-hidden="true">
                      <SectionIcon name={text} size={19} />
                    </span>
                  ))}
                </div>
              ) : (
                <button type="button" className={styles.addSection} data-add-section="" disabled={full} onClick={() => openDraft(SECTIONS)}>
                  <AddSectionIcon size={22} />
                  <span className={styles.addLabel}>Add Section</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <p className={list.caption}>
          {full
            ? `A list has ${HOUSEKEEPING_SECTIONS_MAX} sections at most. `
            : hasSections
              ? ''
              : 'Sections group the tasks, such as Kitchen or Bathrooms. '}
          Changes show in today's visit too. Earlier visits keep their own list.
        </p>
        <span id={taskHintId} className="visually-hidden">
          Drag, or use the up and down arrow keys, to move this task.
        </span>
        <span id={sectionHintId} className="visually-hidden">
          Drag, or use the up and down arrow keys, to move this section.
        </span>
        <div className="visually-hidden" aria-live="polite" data-task-moves="">
          {tasks.announcement}
        </div>
        <div className="visually-hidden" aria-live="polite" data-section-moves="">
          {sectionMoves.announcement}
        </div>
      </div>

      <ActionSheet
        open={taskConfirmOpen}
        title={confirmTask ? `Delete ${confirmTask.title}?` : undefined}
        message="Earlier visits keep it."
        actions={[{ label: 'Delete Task', destructive: true, onSelect: confirmDeleteTask }]}
        onCancel={() => setTaskConfirmOpen(false)}
      />
      <ActionSheet
        open={sectionConfirmOpen}
        title={confirmSection ? `Delete ${confirmSection.title}?` : undefined}
        message={deleteSectionMessage(sectionTasks)}
        actions={[{ label: 'Delete Section', destructive: true, onSelect: confirmDeleteSection }]}
        onCancel={() => setSectionConfirmOpen(false)}
      />
    </div>
  );
}

/**
 * The name of a new task or section, typed where Add was: it wraps as it grows, Enter or
 * leaving it makes the item with what is there (nothing typed adds nothing), and Escape drops
 * it. `lead` draws what comes before it from the text (a section's drawing follows its name).
 */
function DraftField({
  initial,
  className,
  label,
  placeholder,
  maxLength,
  lead,
  onFinish,
}: {
  initial: string;
  className: string;
  label: string;
  placeholder: string;
  maxLength: number;
  lead?: (text: string) => ReactNode;
  onFinish(how: DraftEnd, text: string): void;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      {lead?.(text)}
      <AutoGrowTextarea
        className={className}
        data-draft-input=""
        aria-label={label}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
        onBlur={() => onFinish('blur', text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onFinish('enter', text);
          } else if (e.key === 'Escape') {
            // Dropped, and the Escape kept from closing the sheet.
            e.preventDefault();
            e.stopPropagation();
            onFinish('escape', text);
          }
        }}
      />
    </>
  );
}
