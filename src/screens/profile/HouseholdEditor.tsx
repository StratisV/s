import { useId, useMemo, useRef, useState, type Ref } from 'react';
import { useHousehold } from '../../state/HomeProvider';
import { ChevronLeftIcon } from '../../ui/icons';
import { LargeTitle } from '../../ui/Screen';
import { AreaList } from './AreaList';
import { InlineText } from './InlineText';
import { NavPage } from './NavPage';
import list from './List.module.css';
import styles from './HouseholdEditor.module.css';

interface HouseholdEditorProps {
  onBack(): void;
  backRef?: Ref<HTMLButtonElement>;
}

/** Household details and areas, pushed inside Profile. Every member can edit all of it. */
export function HouseholdEditor({ onBack, backRef }: HouseholdEditorProps) {
  const { data, updateHousehold } = useHousehold();
  const scrollRef = useRef<HTMLDivElement>(null);
  const areasHeadingId = useId();
  const { household } = data;
  const save = (patch: Parameters<typeof updateHousehold>[0]) => void updateHousehold(patch).catch(() => {});

  return (
    <NavPage
      scrollRef={scrollRef}
      inlineTitle="Household"
      leading={
        <button ref={backRef} type="button" className={styles.back} onClick={onBack}>
          <ChevronLeftIcon size={22} strokeWidth={2.6} />
          Profile
        </button>
      }
    >
      <LargeTitle title="Household" />
      <div className={`${list.card} ${styles.details}`}>
        <label className={list.row}>
          <span className={list.label}>Name</span>
          <InlineText
            className={styles.input}
            value={household.name}
            placeholder="Our home"
            autoCapitalize="words"
            maxLength={60}
            onCommit={(name) => save({ name })}
          />
        </label>
        <label className={list.row}>
          <span className={list.label}>Address</span>
          <InlineText
            className={styles.input}
            value={household.address}
            placeholder="Optional"
            autoCapitalize="words"
            maxLength={120}
            allowBlank
            onCommit={(address) => save({ address })}
          />
        </label>
        <TimeZoneRow value={household.timezone} onChange={(timezone) => save({ timezone })} />
      </div>

      <section aria-labelledby={areasHeadingId}>
        <h2 id={areasHeadingId} className={list.header}>
          Areas
        </h2>
        <AreaList scrollRef={scrollRef} />
      </section>
    </NavPage>
  );
}

function allTimeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    /* older browsers: offer the current zone only */
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

/** "America/Los_Angeles" → "Los Angeles". */
function zoneCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/**
 * "Time zone ..... London". The native select covers the row, so a tap
 * opens the system picker and keyboards get a real control.
 */
function TimeZoneRow({ value, onChange }: { value: string; onChange(zone: string): void }) {
  const id = useId();
  const zones = useMemo(() => allTimeZones(value), [value]);
  // Only ring the row for keyboard focus (selects match :focus-visible on tap in some browsers).
  const [pointer, setPointer] = useState(false);
  return (
    <div
      className={`${list.row} ${styles.selectRow}`}
      data-pointer={pointer || undefined}
      onPointerDown={() => setPointer(true)}
      onKeyDown={() => setPointer(false)}
      onBlur={() => setPointer(false)}
    >
      <label htmlFor={id} className={list.label}>
        Time zone
      </label>
      <span className={`${list.value} ${styles.selectValue}`} aria-hidden="true">
        {zoneCity(value)}
      </span>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </div>
  );
}
