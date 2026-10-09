import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { NOTIFY_OPTIONS, REPEAT_OPTIONS } from '../../lib/constants';
import { draftOf, dueDetail, memberLabel, newItemDraft } from '../../lib/logic/items';
import type { ItemDraft, Notify, Repeat } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { useConfetti } from '../../ui/Confetti';
import { CheckIcon, XMarkIcon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import type { ItemSheetTarget } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { DateRow, DetailsCard, SelectRow } from './DetailRows';
import { canSave, changedFields, isDirty, normalizeDraft, singleLine } from './draft';
import { RagPicker } from './RagPicker';
import styles from './ItemSheet.module.css';

interface ItemSheetProps {
  target: ItemSheetTarget;
  open: boolean;
  onClose(): void;
  onExited(): void;
}

/** Mark as Done waits this long before closing so the confetti can be seen. */
const DONE_CLOSE_MS = 600;
const UNASSIGNED = '';

type Confirm = 'discard' | 'delete' | null;

/**
 * Item sheet, edit and new (README "2. Item sheet"). App mounts a fresh
 * instance per opening, so the draft is taken from the target once.
 */
export function ItemSheet({ target, open, onClose, onExited }: ItemSheetProps) {
  const home = useHousehold();
  const { data, today } = home;
  const fire = useConfetti();

  const isNew = target.kind === 'new';
  const itemId = target.kind === 'edit' ? target.itemId : null;
  const item = itemId ? (data.items.find((i) => i.id === itemId) ?? null) : null;
  const areas = useMemo(() => [...data.areas].sort((a, b) => a.position - b.position), [data.areas]);

  const [base] = useState<ItemDraft>(() => {
    if (item) return draftOf(item);
    const preselected = target.kind === 'new' && target.areaId && areas.some((a) => a.id === target.areaId);
    return newItemDraft(preselected && target.kind === 'new' ? target.areaId! : (areas[0]?.id ?? ''), today);
  });
  const [draft, setDraft] = useState<ItemDraft>(base);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>();
  // Latest values for async continuations and effects.
  const latest = useRef({ home, onClose });
  latest.current = { home, onClose };
  const completingRef = useRef(false);

  // A new item's area must still exist when it is saved.
  const areaId = areas.some((a) => a.id === draft.area_id) ? draft.area_id : (areas[0]?.id ?? '');
  const effective: ItemDraft = { ...draft, area_id: areaId };
  const dirty = isDirty(base, effective);
  const savable = canSave(effective);
  const busy = !open || saving || completing;

  const update = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const close = () => {
    setConfirm(null);
    onClose();
  };

  // Deleted or completed elsewhere: nothing left to edit.
  useEffect(() => {
    if (itemId && !item && open && !completingRef.current) {
      setConfirm(null);
      latest.current.onClose();
    }
  }, [itemId, item, open]);

  useEffect(() => () => clearTimeout(doneTimer.current), []);

  // New item: focus the title once the sheet has taken focus (it focuses itself when open).
  useEffect(() => {
    if (!isNew) return;
    const title = titleRef.current;
    const panel = title?.closest<HTMLElement>('[role="dialog"]');
    if (!title) return;
    const focusTitle = () => title.focus({ preventScroll: true });
    if (!panel || document.activeElement === panel) {
      focusTitle();
      return;
    }
    panel.addEventListener('focus', focusTitle, { once: true });
    return () => panel.removeEventListener('focus', focusTitle);
  }, [isNew]);

  const requestClose = () => {
    if (busy || confirm) return;
    if (dirty) setConfirm('discard');
    else close();
  };

  const save = async () => {
    if (busy || confirm || !savable) return;
    if (isNew) {
      setSaving(true);
      try {
        await home.createItem(normalizeDraft(effective));
        close();
      } catch {
        // The provider shows the error; keep the sheet so nothing typed is lost.
        setSaving(false);
      }
      return;
    }
    const patch = changedFields(base, effective);
    if (itemId && Object.keys(patch).length) void home.updateItem(itemId, patch).catch(() => {});
    close();
  };

  const markDone = (e: MouseEvent<HTMLButtonElement>) => {
    if (!itemId || busy || confirm || completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    fire(e.currentTarget);
    navigator.vibrate?.(10);
    doneTimer.current = setTimeout(() => latest.current.onClose(), DONE_CLOSE_MS);

    // Save pending edits first (a blank title keeps the old one), then complete.
    const patch = changedFields(base, effective);
    if (!effective.title.trim()) delete patch.title;
    void (async () => {
      if (Object.keys(patch).length) {
        try {
          await home.updateItem(itemId, patch);
        } catch {
          /* the provider shows the error */
        }
      }
      await latest.current.home.completeItem(itemId).catch(() => {});
    })();
  };

  const confirmDelete = () => {
    if (!itemId) return;
    void home.deleteItem(itemId).catch(() => {});
    close();
  };

  const onTitleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const note = noteRef.current;
    if (!note) return;
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  };

  // Cmd/Ctrl + Enter saves from anywhere in the sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  };

  const due = dueDetail(draft.due_date, today);
  const assignee = data.members.find((m) => m.id === draft.assignee_id);
  const memberOptions = [
    ...data.members.map((m) => ({ value: m.id, label: memberLabel(m) })),
    { value: UNASSIGNED, label: 'Unassigned' },
  ];
  const areaOptions = areas.map((a) => ({ value: a.id, label: a.name }));

  return (
    <Sheet open={open} onRequestClose={requestClose} onExited={onExited} label={isNew ? 'New item' : 'Edit item'}>
      <div className={styles.root} onKeyDown={onKeyDown}>
        <div className={styles.nav} data-sheet-handle>
          <button type="button" className={styles.close} aria-label="Close" onClick={requestClose}>
            <XMarkIcon size={22} strokeWidth={2.5} />
          </button>
          <span />
          <button
            type="button"
            className={styles.save}
            aria-label="Save"
            onClick={() => void save()}
            disabled={!savable || saving}
            aria-busy={saving || undefined}
          >
            <CheckIcon size={24} strokeWidth={2.7} />
          </button>
        </div>

        <div className={styles.body} data-sheet-scroll>
          <div className={styles.text}>
            <AutoGrowTextarea
              ref={titleRef}
              className={styles.title}
              value={draft.title}
              onChange={(e) => update({ title: singleLine(e.target.value) })}
              onKeyDown={onTitleKeyDown}
              placeholder="Title"
              aria-label="Title"
              enterKeyHint="next"
              autoCapitalize="sentences"
            />
            <AutoGrowTextarea
              ref={noteRef}
              className={styles.note}
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
              placeholder="Add a note"
              aria-label="Note"
              autoCapitalize="sentences"
            />
          </div>

          <RagPicker value={draft.rag} onChange={(rag) => update({ rag })} />

          <DetailsCard>
            <SelectRow
              label="Area"
              value={areaId}
              options={areaOptions}
              onChange={(area_id) => update({ area_id })}
              display={areas.find((a) => a.id === areaId)?.name ?? 'None'}
            />
            <DateRow
              label="Due"
              value={draft.due_date}
              display={due.text}
              missed={due.missed}
              onChange={(due_date) => update({ due_date })}
            />
            <SelectRow
              label="Assigned to"
              value={draft.assignee_id ?? UNASSIGNED}
              options={memberOptions}
              onChange={(id) => update({ assignee_id: id === UNASSIGNED ? null : id })}
              display={memberLabel(assignee)}
            />
            <SelectRow<Repeat>
              label="Repeat"
              value={draft.repeat}
              options={REPEAT_OPTIONS}
              onChange={(repeat) => update({ repeat })}
            />
            <SelectRow<Notify>
              label="Notify"
              value={draft.notify}
              options={NOTIFY_OPTIONS}
              onChange={(notify) => update({ notify })}
            />
          </DetailsCard>

          {!isNew ? (
            <>
              <button type="button" className={styles.done} onClick={markDone} aria-disabled={completing || undefined}>
                Mark as Done
              </button>
              <button
                type="button"
                className={styles.delete}
                onClick={() => !busy && setConfirm('delete')}
                aria-haspopup="dialog"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      <ActionSheet
        open={confirm === 'discard'}
        title={isNew ? 'Discard this item?' : 'Discard your changes?'}
        actions={[{ label: 'Discard Changes', destructive: true, onSelect: close }]}
        cancelLabel="Keep Editing"
        onCancel={() => setConfirm(null)}
      />
      <ActionSheet
        open={confirm === 'delete'}
        title="Delete this item?"
        message="It will be removed for everyone in the household."
        actions={[{ label: 'Delete Item', destructive: true, onSelect: confirmDelete }]}
        onCancel={() => setConfirm(null)}
      />
    </Sheet>
  );
}
