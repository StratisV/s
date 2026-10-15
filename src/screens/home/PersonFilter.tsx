import { hasJoined } from '../../lib/logic/people';
import type { Member } from '../../lib/types';
import { EmojiText } from '../../ui/EmojiText';
import { ChevronDownIcon, PeopleIcon } from '../../ui/icons';
import { Menu, type MenuItem } from '../../ui/Menu';
import type { PersonFilter as Filter } from './personFilter';
import styles from './PersonFilter.module.css';

interface PersonFilterProps {
  members: Member[];
  /** The signed-in member: Mine, and listed first after Everyone. */
  meId: string;
  value: Filter;
  counts: Record<string, number>;
  onChange(value: Filter): void;
}

/** "5 open": how many open items someone has, as the menu shows it. */
const open = (n: number) => `${n} open`;
/** "5 items", as VoiceOver says it. */
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** Whose tasks a filter shows, in words: "Everyone", "Stratis (you)", "Shea", "Unassigned". */
export function filterName(value: Filter, members: Member[], meId: string): string {
  if (value === 'all') return 'Everyone';
  if (value === 'none') return 'Unassigned';
  const member = members.find((m) => m.id === value);
  if (!member) return 'Everyone';
  return member.id === meId ? `${member.name} (you)` : member.name;
}

/**
 * Whose tasks Home shows, in two quiet controls beside the view switch:
 *
 * - **Mine**, one tap: a toggle with your emoji. On, Home shows only your items; tap it again
 *   for everyone's. (The most common choice, so it never sits in a menu.)
 * - **The people menu**, a small pill: Everyone, you, each person and Unassigned, each with
 *   how many open items they have and, for someone who has not joined yet, a note saying so
 *   (Apple Reminders' and Linear's scopes, in place of a row of chips). While it narrows Home
 *   to someone else (or the unassigned), it shows their emoji on a tint wash.
 */
export function PersonFilter({ members, meId, value, counts, onChange }: PersonFilterProps) {
  const me = members.find((m) => m.id === meId) ?? null;
  const people = [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const mine = me !== null && value === meId;
  // Someone other than you (or the unassigned): the pill shows who, washed in the tint.
  const other = value !== 'all' && !mine;
  const chosen = other ? members.find((m) => m.id === value) : undefined;
  const name = filterName(value, members, meId);

  const options: MenuItem[] = [
    {
      key: 'all',
      label: 'Everyone',
      lead: <PeopleIcon size={19} />,
      detail: open(counts.all ?? 0),
      ariaLabel: `Everyone, ${items(counts.all ?? 0)}`,
      checked: value === 'all',
      onSelect: () => onChange('all'),
    },
    ...people.map((m, i) => {
      const label = m.id === meId ? `${m.name} (you)` : m.name;
      const joined = hasJoined(m);
      return {
        key: m.id,
        label,
        lead: <EmojiText text={m.emoji} />,
        detail: open(counts[m.id] ?? 0),
        note: joined ? undefined : 'Not joined yet',
        ariaLabel: `${label}, ${items(counts[m.id] ?? 0)}${joined ? '' : ', not joined yet'}`,
        checked: value === m.id,
        groupStart: i === 0,
        onSelect: () => onChange(m.id),
      };
    }),
    {
      key: 'none',
      label: 'Unassigned',
      lead: <span className={styles.nobody} />,
      detail: open(counts.none ?? 0),
      ariaLabel: `Unassigned, ${items(counts.none ?? 0)}`,
      checked: value === 'none',
      groupStart: true,
      onSelect: () => onChange('none'),
    },
  ];

  return (
    <>
      {me ? (
        <button
          type="button"
          className={styles.mine}
          aria-pressed={mine}
          aria-label="Mine"
          data-person-mine=""
          onClick={() => onChange(mine ? 'all' : me.id)}
        >
          <span className={styles.mineEmoji} aria-hidden="true">
            <EmojiText text={me.emoji} />
          </span>
          <span className={styles.mineWord} aria-hidden="true">
            Mine
          </span>
        </button>
      ) : null}
      <Menu label="Show tasks for" title="Show tasks for" items={options}>
        {({ ref, ...trigger }) => (
          <button
            ref={ref}
            type="button"
            className={styles.button}
            data-filtered={other || undefined}
            aria-label={`Show tasks for: ${name}`}
            {...trigger}
          >
            <span className={styles.lead} aria-hidden="true">
              {chosen ? <EmojiText text={chosen.emoji} /> : value === 'none' ? <span className={styles.nobody} /> : <PeopleIcon size={19} />}
            </span>
            <ChevronDownIcon className={styles.chevron} size={11} strokeWidth={2.6} />
          </button>
        )}
      </Menu>
    </>
  );
}
