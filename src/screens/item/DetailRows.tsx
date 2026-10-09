import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import styles from './DetailRows.module.css';

/** White card (radius 26) holding the detail rows, separated by hairlines. */
export function DetailsCard({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

interface RowShellProps {
  id: string;
  label: string;
  value: ReactNode;
  valueId?: string;
  missed?: boolean;
  children: ReactNode;
}

/**
 * A row reads "Label ........ value". The real native control is stretched
 * invisibly over the whole row, so a tap anywhere opens the system picker
 * (iOS wheel, calendar) and keyboards and screen readers get a real field.
 */
function RowShell({ id, label, value, valueId, missed, children }: RowShellProps) {
  // Only show the focus ring when focus came from the keyboard: date inputs
  // match :focus-visible on click and tap too.
  const [pointer, setPointer] = useState(false);
  return (
    <div
      className={styles.row}
      data-pointer={pointer || undefined}
      onPointerDown={() => setPointer(true)}
      onKeyDown={() => setPointer(false)}
      onBlur={() => setPointer(false)}
    >
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <span id={valueId} className={styles.value} data-missed={missed || undefined} aria-hidden="true">
        {value}
      </span>
      {children}
    </div>
  );
}

interface SelectRowProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  /** Shown on the right; defaults to the selected option's label. */
  display?: ReactNode;
}

export function SelectRow<T extends string>({ label, value, options, onChange, display }: SelectRowProps<T>) {
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <RowShell id={id} label={label} value={display ?? current?.label ?? ''}>
      <select
        id={id}
        className={styles.control}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={options.length === 0}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </RowShell>
  );
}

interface DateRowProps {
  label: string;
  /** `YYYY-MM-DD`, or null for no date. */
  value: string | null;
  display: string;
  missed: boolean;
  onChange(value: string | null): void;
}

export function DateRow({ label, value, display, missed, onChange }: DateRowProps) {
  const id = useId();
  const valueId = useId();

  // Desktop browsers only open the calendar from its own icon; open it from
  // anywhere on the row. Touch devices already open their picker on tap.
  const openPicker = (e: MouseEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (typeof input.showPicker !== 'function') return;
    const type = (e.nativeEvent as PointerEvent).pointerType;
    const finePointer = type
      ? type === 'mouse' || type === 'pen'
      : !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    if (!finePointer) return;
    try {
      input.showPicker();
    } catch {
      /* not allowed here (e.g. a cross-origin frame): the field still works */
    }
  };

  return (
    <RowShell id={id} label={label} value={display} valueId={valueId} missed={missed}>
      <input
        id={id}
        type="date"
        className={styles.control}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        onClick={openPicker}
        aria-describedby={valueId}
      />
    </RowShell>
  );
}
