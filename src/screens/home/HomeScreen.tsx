import { useId, useMemo } from 'react';
import { itemMeta, itemsByArea } from '../../lib/logic/items';
import type { Area, ISODate, Item, Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { HomeScene } from '../../ui/HomeScene';
import { PlusIcon } from '../../ui/icons';
import { LargeTitle, Screen } from '../../ui/Screen';
import { ItemRow } from './ItemRow';
import styles from './HomeScreen.module.css';

interface HomeScreenProps {
  onOpenItem(itemId: string): void;
  /** The + in an area header: a new item in that area. */
  onAddItem(areaId: string): void;
  onOpenProfile(): void;
}

/** Home: the household's areas, each with its open items (README "1. Home"). */
export function HomeScreen({ onOpenItem, onAddItem, onOpenProfile }: HomeScreenProps) {
  const { data, me, today, completeItem } = useHousehold();
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);

  return (
    <Screen label="Home" avatarEmoji={me.emoji} onAvatar={onOpenProfile}>
      <LargeTitle title="Home" subtitle={data.household.address.trim() || undefined} />
      <div className={styles.scene}>
        <HomeScene height={150} />
      </div>
      {sections.length ? (
        sections.map(({ area, items }) => (
          <AreaSection
            key={area.id}
            area={area}
            items={items}
            members={data.members}
            today={today}
            onOpenItem={onOpenItem}
            onAddItem={onAddItem}
            onComplete={completeItem}
          />
        ))
      ) : (
        <NoAreas onOpenProfile={onOpenProfile} />
      )}
    </Screen>
  );
}

/**
 * Every area was deleted (the Household editor keeps one, but two people can
 * each delete one at the same time): say where to add one, since items need an area.
 */
function NoAreas({ onOpenProfile }: { onOpenProfile(): void }) {
  return (
    <div className={styles.noAreas}>
      <p className={styles.noAreasText}>
        <strong>No areas yet</strong>
        Items live in an area, like Kitchen or Garden. Add one in Profile, under Household.
      </p>
      <button type="button" className={styles.noAreasButton} onClick={onOpenProfile}>
        Open Profile
      </button>
    </div>
  );
}

interface AreaSectionProps {
  area: Area;
  items: Item[];
  members: Member[];
  today: ISODate;
  onOpenItem(itemId: string): void;
  onAddItem(areaId: string): void;
  onComplete(itemId: string): Promise<void>;
}

function AreaSection({ area, items, members, today, onOpenItem, onAddItem, onComplete }: AreaSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className={styles.headerRow}>
        <h2 id={headingId} className={styles.header}>
          {area.name}
        </h2>
        <button
          type="button"
          className={styles.areaAdd}
          aria-label={`Add item to ${area.name}`}
          onClick={() => onAddItem(area.id)}
        >
          <span className={styles.areaAddGlyph}>
            <PlusIcon size={16} strokeWidth={2.8} />
          </span>
        </button>
      </div>
      <div className={styles.card}>
        {items.length ? (
          <ul className={styles.list} role="list">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                meta={itemMeta(item, members, today)}
                onOpen={onOpenItem}
                onComplete={onComplete}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing to do</p>
        )}
      </div>
    </section>
  );
}
