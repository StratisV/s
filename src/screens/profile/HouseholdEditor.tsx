import { useId, useMemo, useRef, useState, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { hasJoined } from '../../lib/logic/people';
import type { Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { ChevronRightIcon, PlusIcon } from '../../ui/icons';
import { LargeTitle } from '../../ui/Screen';
import { AreaList } from './AreaList';
import { NOT_JOINED } from './GoogleEmailField';
import { InlineText } from './InlineText';
import { BackButton, NavPage } from './NavPage';
import list from './List.module.css';
import people from './People.module.css';
import styles from './HouseholdEditor.module.css';

interface HouseholdEditorProps {
  onBack(): void;
  /** Pushes a member's page (name and emoji; the email and Remove for someone who has not joined). */
  onOpenPerson(memberId: string): void;
  /** Pushes the Add Person page. */
  onAddPerson(): void;
  backRef?: Ref<HTMLButtonElement>;
}

/** Household details, people and areas, pushed inside Profile. Every member can edit all of it. */
export function HouseholdEditor({ onBack, onOpenPerson, onAddPerson, backRef }: HouseholdEditorProps) {
  const { data, me, updateHousehold } = useHousehold();
  const scrollRef = useRef<HTMLDivElement>(null);
  const peopleHeadingId = useId();
  const areasHeadingId = useId();
  const { household } = data;
  const save = (patch: Parameters<typeof updateHousehold>[0]) => void updateHousehold(patch).catch(() => {});

  return (
    <NavPage
      scrollRef={scrollRef}
      inlineTitle="Household"
      leading={<BackButton label="Profile" onClick={onBack} buttonRef={backRef} />}
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
            maxLength={TEXT_LIMITS.householdName}
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
            maxLength={TEXT_LIMITS.address}
            allowBlank
            onCommit={(address) => save({ address })}
          />
        </label>
        <TimeZoneRow value={household.timezone} onChange={(timezone) => save({ timezone })} />
      </div>

      <section aria-labelledby={peopleHeadingId}>
        <h2 id={peopleHeadingId} className={list.header}>
          People
        </h2>
        <div className={list.card}>
          {data.members.map((member) => (
            <PersonRow key={member.id} member={member} isMe={member.id === me.id} onOpen={onOpenPerson} />
          ))}
          <button type="button" className={`${list.row} ${people.addRow}`} data-add-person="" onClick={onAddPerson}>
            <span className={people.addIcon} aria-hidden="true">
              <PlusIcon size={20} strokeWidth={2.4} />
            </span>
            <span className={people.personText}>Add Person</span>
          </button>
        </div>
      </section>

      <section aria-labelledby={areasHeadingId}>
        <h2 id={areasHeadingId} className={list.header}>
          Areas
        </h2>
        <AreaList scrollRef={scrollRef} />
      </section>
    </NavPage>
  );
}

/**
 * A member, as in the Stats legend, opening their page. Someone who has not joined yet has a
 * quiet second line: "Not joined yet · shea@gmail.com" (or "· No email yet").
 */
function PersonRow({ member, isMe, onOpen }: { member: Member; isMe: boolean; onOpen(memberId: string): void }) {
  const joined = hasJoined(member);
  return (
    <button type="button" className={list.row} data-member-row={member.id} onClick={() => onOpen(member.id)}>
      <Avatar emoji={member.emoji} size={36} emojiSize={20} background="var(--bg)" ring={member.color} />
      {joined ? (
        <span className={styles.personName}>{member.name}</span>
      ) : (
        <span className={people.personText}>
          <span className={people.personName}>{member.name}</span>
          <span className={people.personDetail}>
            <span className="visually-hidden">, </span>
            {NOT_JOINED}
            <span aria-hidden="true"> · </span>
            <span className="visually-hidden">, </span>
            {member.email || 'No email yet'}
          </span>
        </span>
      )}
      {isMe ? (
        <span className={styles.you}>
          <span className="visually-hidden">, </span>You
        </span>
      ) : null}
      <ChevronRightIcon className={list.chevron} />
    </button>
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
