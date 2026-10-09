import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { KIND_OPTIONS, NOTIFY_OPTIONS, REPEAT_OPTIONS, TEXT_LIMITS } from '../../lib/constants';
import { draftOf, dueDetail, memberLabel, newItemDraft, withKind } from '../../lib/logic/items';
import { itemShareMessage } from '../../lib/logic/share';
import { appBaseUrl } from '../../lib/sharedLink';
import type { ItemDraft, ItemKind, Notify, Repeat } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { useConfetti } from '../../ui/Confetti';
import { CheckIcon, ShareIcon, XMarkIcon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { SegmentedControl } from '../stats/SegmentedControl';
import { useShare } from '../share/useShare';
import type { ItemSheetTarget } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { DateRow, DetailsCard, SelectRow } from './DetailRows';
import { canSave, changedFields, clip, isDirty, normalizeDraft, singleLine } from './draft';
import { RagPicker } from './RagPicker';
import styles from './ItemSheet.module.css';

interface ItemSheetProps {
  target: ItemSheetTarget;
  open: boolean;
  onClose(): void;
  onExited(): void;
  /** Saved into this area: a new item, or one moved to another area (Home shows it there). */
  onSaved?(areaId: string): void;
}

/** Mark as Done waits this long before closing so the confetti can be seen. */
const DONE_CLOSE_MS = 600;
const UNASSIGNED = '';

type Confirm = 'discard' | 'delete' | null;

/**
 * Item sheet, edit and new (README "2. Item sheet"). App mounts a fresh
 * instance per opening, so the draft is taken from the target once.
 */
export function ItemSheet({ target, open, onClose, onExited, onSaved }: ItemSheetProps) {
  const home = useHousehold();
  const { data, today } = home;
  const fire = useConfetti();
  const share = useShare();

  const isNew = target.kind === 'new';
  const itemId = target.kind === 'edit' ? target.itemId : null;
  const item = itemId ? (data.items.find((i) => i.id === itemId) ?? null) : null;
  const areas = useMemo(() => [...data.areas].sort((a, b) => a.position - b.position), [data.areas]);

  const [base, setBase] = useState<ItemDraft>(() => {
    if (item) return draftOf(item);
    // The area it was added from, otherwise the first area.
    const wanted = target.kind === 'new' ? target.areaId : undefined;
    const areaId = wanted && areas.some((a) => a.id === wanted) ? wanted : (areas[0]?.id ?? '');
    return newItemDraft(areaId, today);
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
  const noAreaId = useId();
  const goodId = useId();

  // A new item's area must still exist when it is saved.
  const areaId = areas.some((a) => a.id === draft.area_id) ? draft.area_id : (areas[0]?.id ?? '');
  const effective: ItemDraft = { ...draft, area_id: areaId };
  const dirty = isDirty(base, effective);
  const savable = canSave(effective);
  const busy = !open || saving || completing;

  const update = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  /** To do or To maintain. A state keeps the hidden task fields until it is saved. */
  const setKind = (kind: ItemKind) => setDraft((d) => withKind(d, kind, today, base.kind));
  const maintained = draft.kind === 'state';

  const close = () => {
    setConfirm(null);
    onClose();
  };

  // Someone else made it To do or To maintain while this sheet was open, and the type
  // hasn't been touched here: follow them, so Mark as Done and the task rows match.
  const liveKind = item ? (item.kind ?? 'task') : null;
  useEffect(() => {
    if (!item || !liveKind || liveKind === base.kind || draft.kind !== base.kind) return;
    const follow = (d: ItemDraft): ItemDraft =>
      liveKind === 'state'
        ? { ...d, kind: 'state' }
        : { ...d, kind: 'task', due_date: item.due_date, repeat: item.repeat, notify: item.notify };
    setBase(follow);
    setDraft(follow);
  }, [item, liveKind, base.kind, draft.kind]);

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

  // The action sheet puts focus back where it was when it closes.
  const ask = (kind: Exclude<Confirm, null>) => setConfirm(kind);
  const cancelConfirm = () => setConfirm(null);

  const requestClose = () => {
    if (busy || confirm) return;
    if (dirty) ask('discard');
    else close();
  };

  /** Closes once the write is saved. If it fails the provider says so and the sheet stays, draft and all. */
  const save = async () => {
    if (busy || confirm || !savable) return;
    const patch = changedFields(base, effective);
    if (!isNew && (!itemId || !Object.keys(patch).length)) {
      close();
      return;
    }
    setSaving(true);
    try {
      if (isNew) await home.createItem(normalizeDraft(effective));
      else await home.updateItem(itemId!, patch);
      if (isNew || patch.area_id) onSaved?.(effective.area_id);
      close();
    } catch {
      setSaving(false);
    }
  };

  const markDone = (e: MouseEvent<HTMLButtonElement>) => {
    if (!itemId || busy || confirm || completingRef.current || maintained) return;
    // Made To maintain elsewhere a moment ago (before the sheet followed): it can't be done.
    if (item?.kind === 'state' && draft.kind === base.kind) return;
    completingRef.current = true;
    setCompleting(true);
    fire(e.currentTarget);
    navigator.vibrate?.(10);

    // Save pending edits first (a blank title keeps the old one), then complete.
    const patch = changedFields(base, effective);
    if (!effective.title.trim()) delete patch.title;
    let saved = Object.keys(patch).length === 0;
    let burstOver = false;
    let closed = false;
    // Close once the burst has been seen and the edits are saved.
    const closeWhenReady = () => {
      if (closed || !burstOver || !saved || !completingRef.current) return;
      closed = true;
      latest.current.onClose();
    };
    // A write failed: the provider has said so and put the item back. Stay open.
    const stop = () => {
      if (closed) return;
      clearTimeout(doneTimer.current);
      completingRef.current = false;
      setCompleting(false);
    };
    doneTimer.current = setTimeout(() => {
      burstOver = true;
      closeWhenReady();
    }, DONE_CLOSE_MS);

    void (async () => {
      if (!saved) {
        try {
          await latest.current.home.updateItem(itemId, patch);
        } catch {
          stop();
          return;
        }
        saved = true;
        setBase((b) => ({ ...b, ...patch }));
        closeWhenReady();
      }
      try {
        await latest.current.home.completeItem(itemId);
      } catch {
        stop();
      }
    })();
  };

  /** The item as saved (what the link opens), not unsaved edits in the sheet. */
  const shareItem = () => {
    if (!item || busy || confirm) return;
    share(
      itemShareMessage(item, data.areas, {
        members: data.members,
        today,
        timeZone: data.household.timezone,
        baseUrl: appBaseUrl(),
      }),
    );
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
          <div className={styles.trailing}>
            {/* A saved item can be shared; a new one has nothing to link to yet. */}
            {item ? (
              <button type="button" className={styles.share} aria-label="Share item" onClick={shareItem}>
                <ShareIcon size={22} strokeWidth={2.1} />
              </button>
            ) : null}
            <button
              type="button"
              className={styles.save}
              aria-label="Save"
              onClick={() => void save()}
              disabled={!savable || saving}
              aria-busy={saving || undefined}
              aria-describedby={areas.length === 0 ? noAreaId : undefined}
            >
              <CheckIcon size={24} strokeWidth={2.7} />
            </button>
          </div>
        </div>

        <div className={styles.body} data-sheet-scroll>
          <div className={styles.text}>
            <AutoGrowTextarea
              ref={titleRef}
              className={styles.title}
              value={draft.title}
              onChange={(e) => update({ title: clip(singleLine(e.target.value), TEXT_LIMITS.itemTitle) })}
              onKeyDown={onTitleKeyDown}
              placeholder="Title"
              aria-label="Title"
              maxLength={TEXT_LIMITS.itemTitle}
              enterKeyHint="next"
              autoCapitalize="sentences"
            />
            <AutoGrowTextarea
              ref={noteRef}
              className={styles.note}
              value={draft.note}
              onChange={(e) => update({ note: clip(e.target.value, TEXT_LIMITS.itemNote) })}
              placeholder="Add a note"
              aria-label="Note"
              maxLength={TEXT_LIMITS.itemNote}
              autoCapitalize="sentences"
            />
          </div>

          <SegmentedControl<ItemKind> label="Type" options={KIND_OPTIONS} value={draft.kind} onChange={setKind} />

          {/* What good looks like: To maintain only. A task keeps it in the draft, unseen. */}
          {maintained ? (
            <div className={styles.good}>
              <label htmlFor={goodId} className={styles.goodHeader}>
                What good looks like
              </label>
              <AutoGrowTextarea
                id={goodId}
                className={styles.goodText}
                value={draft.good}
                onChange={(e) => update({ good: clip(e.target.value, TEXT_LIMITS.itemGood) })}
                placeholder="Describe how it should be kept, e.g. cover on, logs dry and stacked"
                maxLength={TEXT_LIMITS.itemGood}
                autoCapitalize="sentences"
              />
            </div>
          ) : null}

          <RagPicker value={draft.rag} onChange={(rag) => update({ rag })} />

          <DetailsCard>
            <SelectRow
              label="Area"
              value={areaId}
              options={areaOptions}
              onChange={(area_id) => update({ area_id })}
              display={areas.find((a) => a.id === areaId)?.name ?? 'None'}
            />
            {/* A state (To maintain) has no due date, repeat or reminder. */}
            {maintained ? null : (
              <DateRow
                label="Due"
                value={draft.due_date}
                display={due.text}
                missed={due.missed}
                onChange={(due_date) => update({ due_date })}
              />
            )}
            <SelectRow
              label={maintained ? 'Looked after by' : 'Assigned to'}
              value={assignee?.id ?? UNASSIGNED}
              options={memberOptions}
              onChange={(id) => update({ assignee_id: id === UNASSIGNED ? null : id })}
              display={memberLabel(assignee)}
            />
            {maintained ? null : (
              <>
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
              </>
            )}
          </DetailsCard>

          {areas.length === 0 ? (
            <p id={noAreaId} className={styles.caption}>
              Items live in an area. Add one in Profile, under Household.
            </p>
          ) : null}

          {!isNew ? (
            <>
              {/* A state is never done: it stays on the list. */}
              {maintained ? null : (
                <button type="button" className={styles.done} onClick={markDone} aria-disabled={completing || undefined}>
                  Mark as Done
                </button>
              )}
              <button
                type="button"
                className={styles.delete}
                onClick={() => !busy && !confirm && ask('delete')}
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
        onCancel={cancelConfirm}
      />
      <ActionSheet
        open={confirm === 'delete'}
        title="Delete this item?"
        message="It will be removed for everyone in the household."
        actions={[{ label: 'Delete Item', destructive: true, onSelect: confirmDelete }]}
        onCancel={cancelConfirm}
      />
    </Sheet>
  );
}
