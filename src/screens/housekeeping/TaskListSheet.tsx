import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
/** The one group of the sections' own reorder. */
const SECTIONS = 'sections';

/** What the delete confirmation says happens to a section's tasks. */
export function deleteSectionMessage(tasks: number): string {
  const kept =
    tasks === 0
      ? ''
      : tasks === 1
        ? "Its task stays on the list, at the top with no section, on today's visit too. "
        : `Its ${tasks} tasks stay on the list, at the top with no section, on today's visit too. `;
  return `${kept}Earlier visits keep it.`;
}

/**
 * The household's housekeeping task list, edited in place in a page sheet. The tasks in no
 * section come first, in a card with no heading; then a card per section, its drawing and
 * name at the top (renamed in place), its "…" menu (Rename, Move Up, Move Down, Delete
 * Section) and its grip; then Add Section. Each card ends with Add Task. A task is renamed
 * in place, deleted with the red minus (confirmed), moved by dragging its grip (within its
 * section or into another, or the arrow keys on it), or with Move to Section in its "…" menu
 * (there once there are sections). A section moves by its grip too, carried by its header.
 * Today's visit follows the changes; earlier visits keep their own list.
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
    arrangeHousekeepingTasks,
    createHousekeepingSection,
    renameHousekeepingSection,
    deleteHousekeepingSection,
    reorderHousekeepingSections,
  } = useHousehold();
  const groups = taskListGroups(data.housekeeping);
  const sections = groups.flatMap((g) => (g.section ? [g.section] : []));
  const hasSections = sections.length > 0;
  const full = sections.length >= HOUSEKEEPING_SECTIONS_MAX;
  const titleId = useId();
  const taskHintId = useId();
  const sectionHintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  /** The Add Task or Add Section running (its group, or SECTIONS): one at a time. */
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmTask, setConfirmTask] = useState<HousekeepingTask | null>(null);
  const [taskConfirmOpen, setTaskConfirmOpen] = useState(false);
  const [confirmSection, setConfirmSection] = useState<HousekeepingSection | null>(null);
  const [sectionConfirmOpen, setSectionConfirmOpen] = useState(false);
  /** A task its menu just moved: lit up for a moment where it landed. */
  const [moved, setMoved] = useState<string | null>(null);

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
    onReorder: (arrangement) =>
      arrangeHousekeepingTasks(arrangement.map((g) => ({ sectionId: g.id === NONE ? null : g.id, taskIds: g.ids }))),
  });
  const sectionMoves = useGroupedReorder({
    scope: 'sections',
    groups: [{ id: SECTIONS, name: null, ids: sections.map((s) => s.id) }],
    nameOf: (id) => sections.find((s) => s.id === id)?.title ?? '',
    rootRef: listsRef,
    scrollRef,
    onReorder: ([all]) => reorderHousekeepingSections(all.ids),
    liftSelector: '[data-section-head]',
    liftRadius: 20,
  });

  // Where focus goes once the lists show a change: a new task's or section's name (its text
  // selected, to type over), or a control found by its data attribute.
  const focusNext = useRef<{ selector: string; select?: boolean } | null>(null);
  const applyFocus = useCallback(() => {
    const next = focusNext.current;
    const el = next ? listsRef.current?.querySelector<HTMLElement>(next.selector) : null;
    if (!next || !el) return;
    focusNext.current = null;
    if (document.activeElement !== el) el.focus();
    if (next.select && el instanceof HTMLInputElement) el.select();
  }, []);
  useLayoutEffect(applyFocus);
  const focusSoon = (selector: string, select = false) => {
    focusNext.current = { selector, select };
    requestAnimationFrame(applyFocus);
  };

  useEffect(() => {
    if (!moved) return;
    const timer = window.setTimeout(() => setMoved(null), 1400);
    return () => clearTimeout(timer);
  }, [moved]);

  // ── Adding ───────────────────────────────────────────────

  /** Runs an Add: a stand-in field takes the focus inside the tap so iOS raises the keyboard. */
  const add = <T extends { id: string }>(what: string, create: () => Promise<T>, nameSelector: (id: string) => string) => {
    if (adding) return;
    proxyRef.current?.focus({ preventScroll: true });
    setAdding(what);
    create()
      .then((made) => {
        focusNext.current = { selector: nameSelector(made.id), select: true };
        applyFocus();
      })
      .catch(() => {
        // Back to the button pressed (Couldn't save says why).
        if (document.activeElement === proxyRef.current) {
          listsRef.current
            ?.querySelector<HTMLElement>(what === SECTIONS ? '[data-add-section]' : `[data-add-task="${what}"]`)
            ?.focus();
        }
      })
      .finally(() => setAdding(null));
  };
  const addTask = (group: string) =>
    add(group, () => createHousekeepingTask(HOUSEKEEPING_NEW_TASK, group === NONE ? null : group), (id) => `[data-task-input="${id}"]`);
  const addSection = () => {
    if (full) return;
    add(SECTIONS, () => createHousekeepingSection(HOUSEKEEPING_NEW_SECTION), (id) => `[data-section-input="${id}"]`);
  };

  // ── Deleting ─────────────────────────────────────────────

  const confirmDeleteTask = () => {
    setTaskConfirmOpen(false);
    if (!confirmTask) return;
    const group = groups.find((g) => g.tasks.some((t) => t.id === confirmTask.id));
    const index = group?.tasks.findIndex((t) => t.id === confirmTask.id) ?? -1;
    const nextId = group?.tasks[index + 1]?.id ?? group?.tasks[index - 1]?.id;
    void deleteHousekeepingTask(confirmTask.id).catch(() => {});
    // Keep keyboard focus nearby: the next row's delete button, or its card's Add Task.
    focusSoon(nextId ? `[data-delete="${nextId}"]` : `[data-add-task="${group?.section?.id ?? NONE}"]`);
  };

  const confirmDeleteSection = () => {
    setSectionConfirmOpen(false);
    if (!confirmSection) return;
    const index = sections.findIndex((s) => s.id === confirmSection.id);
    const next = sections[index + 1] ?? sections[index - 1];
    void deleteHousekeepingSection(confirmSection.id).catch(() => {});
    focusSoon(next ? `[data-section-menu="${next.id}"]` : '[data-add-section]');
  };
  const sectionTasks = confirmSection ? (groups.find((g) => g.section?.id === confirmSection.id)?.tasks.length ?? 0) : 0;

  // ── Menus ────────────────────────────────────────────────

  const moveTask = (task: HousekeepingTask, from: string, to: string) => {
    if (from === to) return;
    focusNext.current = { selector: `[data-task-menu="${task.id}"]` };
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
    focusNext.current = { selector: `[data-section-menu="${section.id}"]` };
    sectionMoves.move(section.id, SECTIONS, index);
  };
  const sectionMenu = (section: HousekeepingSection, index: number): MenuItem[] => [
    {
      key: 'rename',
      label: 'Rename',
      icon: <PencilIcon size={20} />,
      onSelect: () => focusSoon(`[data-section-input="${section.id}"]`, true),
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

  const addTaskRow = (group: string, name: string | null, empty: boolean) => (
    <button
      type="button"
      className={styles.add}
      data-first={empty || undefined}
      data-add-task={group}
      aria-label={name ? `Add Task to ${name}` : undefined}
      aria-busy={adding === group || undefined}
      onClick={() => addTask(group)}
      {...tasks.endProps(group)}
    >
      <PlusCircleIcon size={22} />
      <span className={styles.addLabel}>Add Task</span>
    </button>
  );

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
        >
          {/* The tasks in no section: first, with no heading. */}
          <div className={styles.card}>
            <ul
              className={styles.list}
              aria-labelledby={hasSections ? undefined : titleId}
              aria-label={hasSections ? 'Tasks in no section' : undefined}
            >
              {loose.tasks.map((task) => taskRow(task, NONE))}
            </ul>
            {addTaskRow(NONE, null, loose.tasks.length === 0)}
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
                  <ul className={styles.list}>{group.tasks.map((task) => taskRow(task, section.id))}</ul>
                  {addTaskRow(section.id, section.title, group.tasks.length === 0)}
                </div>
              </div>
            );
          })}

          <div className={styles.addSectionItem} {...sectionMoves.endProps(SECTIONS)}>
            <div className={styles.card}>
              <button
                type="button"
                className={styles.addSection}
                data-add-section=""
                disabled={full}
                aria-busy={adding === SECTIONS || undefined}
                onClick={addSection}
              >
                <AddSectionIcon size={22} />
                <span className={styles.addLabel}>Add Section</span>
              </button>
            </div>
          </div>
        </div>
        {/* Not read-only: iOS only raises the keyboard for an editable field. */}
        <input ref={proxyRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" />
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
