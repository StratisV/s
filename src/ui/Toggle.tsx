import styles from './Toggle.module.css';

interface ToggleProps {
  checked: boolean;
  onChange(next: boolean): void;
  /** Accessible name (the row label). */
  label: string;
  disabled?: boolean;
}

/** iOS switch (UISwitch), 51×31. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.toggle}
      data-on={checked || undefined}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}
