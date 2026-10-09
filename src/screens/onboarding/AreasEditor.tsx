import { useEffect, useRef, useState } from 'react';
import { MinusCircleIcon, PlusCircleIcon } from '../../ui/icons';
import styles from './AreasEditor.module.css';
import { areaKey, MAX_AREA_NAME, type AreaDraft } from './setup';

interface AreasEditorProps {
  areas: AreaDraft[];
  onChange(next: AreaDraft[]): void;
  labelledBy: string;
  disabled?: boolean;
}

/**
 * The household's areas in an iOS edit-mode list: rename inline, remove with
 * the red minus, and "Add Area" at the end. Blank rows are dropped on blur.
 */
export function AreasEditor({ areas, onChange, labelledBy, disabled }: AreasEditorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // After adding or removing, where focus should go once the list re-renders.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTarget || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-focus="${focusTarget}"]`);
    el?.focus();
    setFocusTarget(null);
  }, [focusTarget, areas]);

  const rename = (key: string, name: string) => onChange(areas.map((a) => (a.key === key ? { ...a, name } : a)));

  const remove = (key: string) => {
    const i = areas.findIndex((a) => a.key === key);
    const next = areas.filter((a) => a.key !== key);
    const neighbour = next[i] ?? next[i - 1];
    onChange(next);
    setFocusTarget(neighbour ? `remove-${neighbour.key}` : 'add');
  };

  const add = () => {
    const key = areaKey();
    onChange([...areas.filter((a) => a.name.trim()), { key, name: '' }]);
    setFocusTarget(`input-${key}`);
  };

  return (
    <ul ref={listRef} className={styles.card} aria-labelledby={labelledBy}>
      {areas.map((a) => {
        const label = a.name.trim() || 'new area';
        return (
          <li key={a.key} className={styles.row}>
            <button
              type="button"
              className={styles.icon}
              onClick={() => remove(a.key)}
              aria-label={`Remove ${label}`}
              data-focus={`remove-${a.key}`}
              disabled={disabled}
            >
              <MinusCircleIcon size={22} />
            </button>
            <div className={styles.field}>
              <input
                className={styles.input}
                value={a.name}
                onChange={(e) => rename(a.key, e.target.value)}
                onBlur={() => {
                  if (!a.name.trim()) onChange(areas.filter((x) => x.key !== a.key));
                }}
                onKeyDown={(e) => {
                  // Enter finishes editing; it must not submit the whole form.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Area name"
                aria-label="Area name"
                maxLength={MAX_AREA_NAME}
                autoCapitalize="words"
                enterKeyHint="done"
                data-focus={`input-${a.key}`}
                disabled={disabled}
              />
            </div>
          </li>
        );
      })}
      <li className={styles.row}>
        <button type="button" className={styles.add} onClick={add} data-focus="add" disabled={disabled}>
          <span className={styles.addIcon}>
            <PlusCircleIcon size={22} />
          </span>
          <span className={styles.field}>Add Area</span>
        </button>
      </li>
    </ul>
  );
}
