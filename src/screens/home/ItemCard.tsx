import { useContext } from 'react';
import type { ISODate, Item, Member } from '../../lib/types';
import { AreaArt } from '../../ui/area-art/AreaArt';
import { itemWords, RowMeta, useCompletion, WhenWords, Who } from './ItemRow';
import { RevealContext } from './reveal';
import { ConditionGauge, StatusRing } from './StatusRing';
import styles from './ItemCard.module.css';

interface ItemCardProps {
  item: Item;
  /** The area it is in: its picture and its name. */
  area: { id: string; name: string };
  members: Member[];
  /** Today in the household's time zone. */
  today: ISODate;
  /** The household's. */
  timeZone: string;
  /** Who it is for, after its area: off while the person filter shows one person's items. */
  showWho: boolean;
  onOpen(itemId: string): void;
  onComplete(itemId: string): Promise<void> | void;
}

/**
 * One item on Needs attention, a card of its own: its area's picture (AreaArt, inset with
 * concentric corners), then its title (two lines at most), its urgency (or condition) in words
 * and when it is due ("2 days late" in red), and its area and who it is for; at the end, the
 * ring that ticks a To do off (or the gauge of a thing looked after). The card opens the item.
 * Assistive tech hears one sentence: "Heaters not working, Urgent, 2 days late, Hallway, Shea,
 * has a note." Ticked off, it folds away, a repeating job too (it moves to a later date). Just
 * saved (RevealContext), a tint ring lights it up for a moment.
 */
export function ItemCard({ item, area, members, today, timeZone, showWho, onOpen, onComplete }: ItemCardProps) {
  const lit = useContext(RevealContext) === item.id;
  const { completing, leaving, busy, openRef, complete } = useCompletion(item.id, true, onComplete);
  const { maintained, member, when, repeat, spoken } = itemWords(item, { members, today, timeZone, room: area.name });

  return (
    <li
      className={styles.item}
      data-kind={item.kind}
      data-item-id={item.id}
      data-lit={lit || undefined}
      data-completing={completing || undefined}
      data-leaving={leaving || undefined}
    >
      <div className={styles.card}>
        <button
          ref={openRef}
          type="button"
          className={styles.open}
          data-item-open=""
          onClick={() => {
            if (!busy.current) onOpen(item.id);
          }}
        >
          <span className={styles.frame}>
            <AreaArt name={area.name} seed={area.id} className={styles.art} />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              {item.title}
              <span className="visually-hidden">{`, ${spoken}.`}</span>
            </span>
            <RowMeta
              kind={item.kind}
              rag={item.rag}
              dot={!maintained}
              parts={[when ? <WhenWords key="when" when={when} repeat={!!repeat} /> : null]}
            />
            <span className={styles.where} aria-hidden="true" data-where="">
              <span className={styles.area} data-room="">
                {area.name}
              </span>
              {member && showWho ? (
                <>
                  <span className={styles.sep}>·</span>
                  <Who member={member} />
                </>
              ) : null}
            </span>
          </span>
        </button>
        <span className={styles.end}>
          {maintained ? (
            <ConditionGauge rag={item.rag} className={styles.mark} />
          ) : (
            <StatusRing done={completing} label={`Mark ${item.title} as done`} onClick={complete} className={styles.mark} />
          )}
        </span>
      </div>
    </li>
  );
}
