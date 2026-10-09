import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { HOUSEKEEPING_NEW_TASK, TEXT_LIMITS } from '../../lib/constants';
import type { HousekeepingTask } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { GripIcon, MinusCircleIcon, PlusCircleIcon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { useReorder } from '../../ui/useReorder';
import { InlineText } from '../profile/InlineText';
import list from '../profile/List.module.css';
import rows from '../profile/AreaList.module.css';
import styles from './TaskListSheet.module.css';

interface TaskListSheetProps {
  open: boolean;
  onClose(): void;
}

/**
 * The household's housekeeping task list, edited in place in a page sheet: rename inline,
 * delete with the red minus (confirmed), reorder by dragging the grip (or the arrow keys on
 * it), and Add Task at the end. It looks and behaves like the Household editor's areas.
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
  const { data, createHousekeepingTask, renameHousekeepingTask, deleteHousekeepingTask, reorderHousekeepingTasks } =
    useHousehold();
  const tasks = data.housekeeping.tasks;
  const titleId = useId();
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<HousekeepingTask | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reorder = useReorder({
    rows: tasks,
    nameOf: (task) => task.title,
    listRef,
    scrollRef,
    onReorder: reorderHousekeepingTasks,
  });

  // A new task's name takes the focus (text selected, to type over) once it shows.
  const focusNew = useRef<string | null>(null);
  const focusNewTask = useCallback(() => {
    const id = focusNew.current;
    const input = id ? listRef.current?.querySelector<HTMLInputElement>(`[data-task-input="${id}"]`) : null;
    if (!input) return;
    focusNew.current = null;
    input.focus();
    input.select();
  }, []);
  useEffect(focusNewTask, [tasks, focusNewTask]);

  const addTask = () => {
    if (adding) return;
    // Focus a stand-in field inside the tap so iOS raises the keyboard; the new task's
    // name takes over the focus once it appears.
    proxyRef.current?.focus({ preventScroll: true });
    setAdding(true);
    createHousekeepingTask(HOUSEKEEPING_NEW_TASK)
      .then((task) => {
        focusNew.current = task.id;
        focusNewTask();
      })
      .catch(() => {
        if (document.activeElement === proxyRef.current) addRef.current?.focus();
      })
      .finally(() => setAdding(false));
  };

  const askDelete = (task: HousekeepingTask) => {
    setConfirm(task);
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    setConfirmOpen(false);
    if (!confirm) return;
    const index = tasks.findIndex((t) => t.id === confirm.id);
    void deleteHousekeepingTask(confirm.id).catch(() => {});
    // Keep keyboard focus nearby: the next row's delete button, or Add Task.
    const nextId = tasks[index + 1]?.id ?? tasks[index - 1]?.id;
    requestAnimationFrame(() => {
      const next = nextId ? listRef.current?.querySelector<HTMLElement>(`[data-delete="${nextId}"]`) : null;
      (next ?? addRef.current)?.focus({ preventScroll: true });
    });
  };

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
        <div className={list.card}>
          <ul
            ref={listRef}
            className={rows.list}
            aria-labelledby={titleId}
            data-dragging={reorder.dragging || undefined}
          >
            {tasks.map((task, index) => (
              <li key={task.id} className={rows.row} {...reorder.rowProps(index, task.id)}>
                <button
                  type="button"
                  className={rows.delete}
                  data-delete={task.id}
                  aria-label={`Delete ${task.title}`}
                  onClick={() => askDelete(task)}
                >
                  <MinusCircleIcon size={22} />
                </button>
                <div className={rows.main}>
                  <InlineText
                    className={rows.name}
                    data-task-input={task.id}
                    value={task.title}
                    aria-label="Task name"
                    autoCapitalize="sentences"
                    maxLength={TEXT_LIMITS.housekeepingTask}
                    onCommit={(title) => void renameHousekeepingTask(task.id, title).catch(() => {})}
                  />
                  <button
                    type="button"
                    className={rows.grip}
                    aria-label={`Reorder ${task.title}`}
                    aria-describedby={hintId}
                    {...reorder.gripProps(index, task.id)}
                  >
                    <GripIcon size={22} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            ref={addRef}
            type="button"
            className={rows.add}
            data-first={tasks.length === 0 || undefined}
            onClick={addTask}
            aria-busy={adding || undefined}
          >
            <PlusCircleIcon size={22} />
            <span className={rows.addLabel}>Add Task</span>
          </button>
          {/* Not read-only: iOS only raises the keyboard for an editable field. */}
          <input ref={proxyRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" />
        </div>
        <p className={list.caption}>Changes show in today's visit too. Earlier visits keep their own list.</p>
        <span id={hintId} className="visually-hidden">
          Drag, or use the up and down arrow keys, to move this task.
        </span>
        <div className="visually-hidden" aria-live="polite">
          {reorder.announcement}
        </div>
      </div>

      <ActionSheet
        open={confirmOpen}
        title={confirm ? `Delete ${confirm.title}?` : undefined}
        message="Earlier visits keep it."
        actions={[{ label: 'Delete Task', destructive: true, onSelect: confirmDelete }]}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
