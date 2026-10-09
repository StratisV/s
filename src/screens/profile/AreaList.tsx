import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import type { Area } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { GripIcon, MinusCircleIcon, PlusCircleIcon } from '../../ui/icons';
import { useReorder } from '../../ui/useReorder';
import { InlineText } from './InlineText';
import list from './List.module.css';
import styles from './AreaList.module.css';

const NEW_AREA = 'New area';

/**
 * The household's areas, edited in place: rename inline, delete with the
 * red minus (confirmed), reorder by dragging the grip (or arrow keys on it),
 * and "Add Area" at the end. The last area can't be deleted: items need one.
 */
export function AreaList({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const { data, renameArea, deleteArea, reorderAreas, createArea } = useHousehold();
  const areas = data.areas;
  const hintId = useId();
  const lastHintId = useId();
  const onlyOne = areas.length === 1;
  const listRef = useRef<HTMLUListElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const areasRef = useRef(areas);
  areasRef.current = areas;

  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ area: Area; items: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Focus to restore after the list re-renders: a new area's name.
  const focusNew = useRef<string | null>(null);

  const focusNewArea = useCallback(() => {
    const id = focusNew.current;
    const input = id ? listRef.current?.querySelector<HTMLInputElement>(`[data-area-input="${id}"]`) : null;
    if (!input) return;
    focusNew.current = null;
    input.focus();
    input.select();
  }, []);

  useEffect(focusNewArea, [areas, focusNewArea]);

  const reorder = useReorder({
    rows: areas,
    nameOf: (area) => area.name,
    listRef,
    scrollRef,
    onReorder: reorderAreas,
  });

  // ── Add and delete ───────────────────────────────────────

  const addArea = () => {
    if (adding) return;
    // Focus a stand-in field inside the tap so iOS raises the keyboard; the
    // new area's name takes over the focus once it appears.
    proxyRef.current?.focus({ preventScroll: true });
    setAdding(true);
    createArea(NEW_AREA)
      .then((area) => {
        focusNew.current = area.id;
        focusNewArea();
      })
      .catch(() => {
        if (document.activeElement === proxyRef.current) addRef.current?.focus();
      })
      .finally(() => setAdding(false));
  };

  const askDelete = (area: Area) => {
    if (areasRef.current.length <= 1) return;
    setConfirm({ area, items: data.items.filter((i) => i.area_id === area.id).length });
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    setConfirmOpen(false);
    // Someone else may have deleted the others while the sheet was up.
    if (!confirm || areasRef.current.length <= 1) return;
    const index = areas.findIndex((a) => a.id === confirm.area.id);
    void deleteArea(confirm.area.id).catch(() => {});
    // Keep keyboard focus nearby: the next row's delete button, or Add Area.
    const nextId = areas[index + 1]?.id ?? areas[index - 1]?.id;
    requestAnimationFrame(() => {
      const next = nextId ? listRef.current?.querySelector<HTMLElement>(`[data-delete="${nextId}"]`) : null;
      (next ?? addRef.current)?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <div className={list.card}>
        <ul ref={listRef} className={styles.list} data-dragging={reorder.dragging || undefined}>
          {areas.map((area, index) => (
            <li key={area.id} className={styles.row} {...reorder.rowProps(index, area.id)}>
              <button
                type="button"
                className={styles.delete}
                data-delete={area.id}
                aria-label={`Delete ${area.name}`}
                aria-describedby={onlyOne ? lastHintId : undefined}
                disabled={onlyOne}
                onClick={() => askDelete(area)}
              >
                <MinusCircleIcon size={22} />
              </button>
              <div className={styles.main}>
                <InlineText
                  className={styles.name}
                  data-area-input={area.id}
                  value={area.name}
                  aria-label="Area name"
                  autoCapitalize="words"
                  maxLength={TEXT_LIMITS.areaName}
                  onCommit={(name) => void renameArea(area.id, name).catch(() => {})}
                />
                <button
                  type="button"
                  className={styles.grip}
                  aria-label={`Reorder ${area.name}`}
                  aria-describedby={hintId}
                  {...reorder.gripProps(index, area.id)}
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
          className={styles.add}
          data-first={areas.length === 0 || undefined}
          onClick={addArea}
          aria-busy={adding || undefined}
        >
          <PlusCircleIcon size={22} />
          <span className={styles.addLabel}>Add Area</span>
        </button>
        {/* Not read-only: iOS only raises the keyboard for an editable field. */}
        <input ref={proxyRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" />
      </div>
      {onlyOne ? (
        <p id={lastHintId} className={list.caption}>
          Items live in an area, so keep at least one.
        </p>
      ) : null}
      <span id={hintId} className="visually-hidden">
        Drag, or use the up and down arrow keys, to move this area.
      </span>
      <div className="visually-hidden" aria-live="polite">
        {reorder.announcement}
      </div>

      <ActionSheet
        open={confirmOpen}
        title={confirm ? `Delete ${confirm.area.name}?` : undefined}
        message={
          confirm && confirm.items > 0
            ? `Its ${confirm.items} ${confirm.items === 1 ? 'item' : 'items'} will be deleted too.`
            : undefined
        }
        actions={[{ label: 'Delete Area', destructive: true, onSelect: confirmDelete }]}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
