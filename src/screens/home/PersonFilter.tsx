import { hasJoined } from '../../lib/logic/people';
import type { Member } from '../../lib/types';
import { EmojiText } from '../../ui/EmojiText';
import { ChevronDownIcon, PeopleIcon } from '../../ui/icons';
import { Menu, type MenuItem } from '../../ui/Menu';
import type { PersonFilter as Filter } from './personFilter';
import styles from './PersonFilter.module.css';

interface PersonFilterProps {
  members: Member[];
  /** The signed-in member, listed first after Everyone. */
  meId: string;
  value: Filter;
  counts: Record<string, number>;
  onChange(value: Filter): void;
}

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/**
 * Whose tasks Home shows: one quiet button with the choice on it ("Everyone", or "🦆 Shea"),
 * which opens a menu of Everyone, you, each person and Unassigned, each with how many open
 * items they have (Apple Reminders' and Linear's scopes, in place of a row of chips).
 */
export function PersonFilter({ members, meId, value, counts, onChange }: PersonFilterProps) {
  const people = [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const chosen = members.find((m) => m.id === value);
  const name = value === 'all' ? 'Everyone' : value === 'none' ? 'Unassigned' : (chosen?.name ?? 'Everyone');

  const options: MenuItem[] = [
    {
      key: 'all',
      label: 'Everyone',
      lead: <PeopleIcon size={19} />,
      detail: String(counts.all ?? 0),
      ariaLabel: `Everyone, ${items(counts.all ?? 0)}`,
      checked: value === 'all',
      onSelect: () => onChange('all'),
    },
    ...people.map((m, i) => ({
      key: m.id,
      label: m.id === meId ? `${m.name} (you)` : m.name,
      lead: <EmojiText text={m.emoji} />,
      detail: String(counts[m.id] ?? 0),
      ariaLabel: `${m.id === meId ? `${m.name} (you)` : m.name}, ${items(counts[m.id] ?? 0)}${hasJoined(m) ? '' : ', not joined yet'}`,
      checked: value === m.id,
      groupStart: i === 0,
      onSelect: () => onChange(m.id),
    })),
    {
      key: 'none',
      label: 'Unassigned',
      lead: <span className={styles.nobody} />,
      detail: String(counts.none ?? 0),
      ariaLabel: `Unassigned, ${items(counts.none ?? 0)}`,
      checked: value === 'none',
      groupStart: true,
      onSelect: () => onChange('none'),
    },
  ];

  return (
    <Menu label="Show tasks for" items={options}>
      {({ ref, ...trigger }) => (
        <button
          ref={ref}
          type="button"
          className={styles.button}
          data-filtered={value !== 'all' || undefined}
          aria-label={`Show tasks for: ${name}`}
          {...trigger}
        >
          <span className={styles.lead} aria-hidden="true">
            {chosen ? <EmojiText text={chosen.emoji} /> : value === 'none' ? <span className={styles.nobody} /> : <PeopleIcon size={18} />}
          </span>
          <span className={styles.name}>{name}</span>
          <ChevronDownIcon className={styles.chevron} size={11} strokeWidth={2.6} />
        </button>
      )}
    </Menu>
  );
}
