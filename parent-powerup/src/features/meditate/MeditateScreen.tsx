import { useId, useMemo, useRef, useState } from 'react';
import { CHALLENGES, POWERUPS } from '../../data/library';
import { MEDITATIONS } from '../../data/meditations';
import { formatRange } from '../../lib/age';
import { navigate, routeHash } from '../../lib/route';
import { actions, useAppState } from '../../lib/store';
import type { Kid, Meditation, MeditationMode } from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { KidAvatar } from '../../ui/KidAvatar';
import { Screen, Section } from '../../ui/Screen';
import {
  doneToday,
  listNames,
  minutesOf,
  moreToTry,
  pickPowerup,
  pickToday,
  reasonFor,
  streak,
  youngestAge,
  type PickInput,
} from './pick';
import { Player } from './Player';
import { useToday } from './useToday';
import { greeting, longDate, possessive, streakWords } from './words';
import styles from './MeditateScreen.module.css';

/** How many of "More to try" show before "Show more". */
const MORE_SHOWN = 4;

const addFamily = () => navigate({ tab: 'family', edit: 'new' });

/** "3 min" on screen, "3 minutes" to a screen reader. */
function Minutes({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden="true">{n} min</span>
      <span className="visually-hidden">
        {n} minute{n === 1 ? '' : 's'}
      </span>
    </>
  );
}

/**
 * The home tab: today's meditation, together with the kids or just for you, a gentle streak,
 * a few more to try and today's Powerup.
 */
export function MeditateScreen() {
  const { parent, kids, sessions, welcomed } = useAppState();
  const today = useToday();
  const modeName = useId();
  const [mode, setMode] = useState<MeditationMode>('together');
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [playing, setPlaying] = useState<{ meditation: Meditation; kidIds: string[] } | null>(null);
  const featuredHeading = useRef<HTMLHeadingElement>(null);

  // Everyone joins unless left out; there is always at least one.
  const joining = useMemo(() => {
    const chosen = kids.filter((kid) => !leftOut.includes(kid.id));
    return chosen.length ? chosen : kids;
  }, [kids, leftOut]);

  const input = useMemo<PickInput>(
    () => ({
      mode,
      kids: mode === 'together' ? joining : [],
      parentFocus: parent.focus,
      today,
      sessions,
      meditations: MEDITATIONS,
    }),
    [mode, joining, parent.focus, today, sessions],
  );
  const featured = useMemo(() => pickToday(input), [input]);
  const more = useMemo(() => moreToTry(input, featured), [input, featured]);
  const reason = featured ? reasonFor(featured, input) : undefined;
  const todaysPowerup = useMemo(
    () => pickPowerup({ powerups: POWERUPS, challenges: CHALLENGES, kids, today }),
    [kids, today],
  );

  const days = streak(sessions, today);
  const showWelcome = !welcomed && kids.length === 0;
  const together = mode === 'together';
  const youngest = together ? youngestAge(joining, today) : undefined;
  const youngestKid = together ? joining.slice().sort((a, b) => b.birth.localeCompare(a.birth))[0] : undefined;
  const featuredDone = featured ? doneToday(sessions, today, featured.id) : false;

  const start = (meditation: Meditation) =>
    setPlaying({ meditation, kidIds: meditation.mode === 'together' ? joining.map((kid) => kid.id) : [] });

  const toggleKid = (kid: Kid) =>
    setLeftOut((out) => (out.includes(kid.id) ? out.filter((id) => id !== kid.id) : [...out, kid.id]));

  const changeMode = (next: MeditationMode) => {
    setMode(next);
    setShowAll(false);
  };

  const dismissWelcome = () => {
    actions.setWelcomed();
    // The card is going: keep keyboard and screen reader users in the same place.
    setTimeout(() => featuredHeading.current?.focus(), 0);
  };

  const eyebrow = !together
    ? 'Today, just for you'
    : kids.length
      ? `Today, with ${listNames(joining.map((kid) => kid.name))}`
      : 'Today, together';

  const moreHint = !together
    ? 'For whenever you need a moment'
    : youngestKid
      ? `Also right for ${possessive(youngestKid.name)} age`
      : 'Good for most ages';

  const shown = showAll ? more : more.slice(0, MORE_SHOWN);

  return (
    <Screen
      eyebrow={longDate(today)}
      title={greeting(new Date().getHours(), parent.name)}
      subtitle={
        days > 0 ? (
          <span className={styles.streak}>
            <Icon name="flame" size={18} className={styles.flame} />
            <span>{streakWords(days)}</span>
          </span>
        ) : (
          'A few calm minutes, together or just for you.'
        )
      }
    >
      {showWelcome && (
        <section className={styles.welcome} aria-labelledby="welcome-title">
          <span className={styles.welcomeMark} aria-hidden="true">
            <Icon name="bolt" size={22} />
          </span>
          <h2 id="welcome-title" className={styles.welcomeTitle}>
            Welcome to Parent Powerup
          </h2>
          <p className={styles.welcomeText}>
            A few calm minutes each day, with your kids or just for you. And expert-backed Powerups for the tricky
            bits of growing up.
          </p>
          <div className={styles.welcomeActions}>
            <Button
              icon="plus"
              onClick={() => {
                actions.setWelcomed();
                addFamily();
              }}
            >
              Add your family
            </Button>
            <Button variant="ghost" onClick={dismissWelcome}>
              Not now
            </Button>
          </div>
        </section>
      )}

      <div className={styles.choose}>
        <fieldset className={styles.modes}>
          <legend className="visually-hidden">Who’s meditating?</legend>
          {(
            [
              ['together', 'Together', 'family'],
              ['solo', 'Just me', 'user'],
            ] as const
          ).map(([value, label, icon]) => (
            <label key={value} className={styles.mode} data-checked={mode === value || undefined}>
              <input
                type="radio"
                className={`visually-hidden ${styles.modeInput}`}
                name={modeName}
                value={value}
                checked={mode === value}
                onChange={() => changeMode(value)}
              />
              <Icon name={icon} size={20} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {together && kids.length > 1 && (
          <div className={styles.joining}>
            <p className={styles.joiningHint} id="joining-hint">
              Tap anyone who’s not joining today.
            </p>
            <div className={styles.kids} role="group" aria-label="Who’s joining" aria-describedby="joining-hint">
              {kids.map((kid) => {
                const joined = joining.includes(kid);
                const onlyOne = joined && joining.length === 1;
                return (
                  <button
                    key={kid.id}
                    type="button"
                    className={styles.kid}
                    aria-pressed={joined}
                    aria-disabled={onlyOne || undefined}
                    onClick={() => !onlyOne && toggleKid(kid)}
                  >
                    <span className={styles.kidFace}>
                      <KidAvatar kid={kid} size={52} />
                      {joined && (
                        <span className={styles.kidTick} aria-hidden="true">
                          <Icon name="check" size={13} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className={styles.kidName}>{kid.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {together && !kids.length && !showWelcome && (
          <div className={styles.nudge}>
            <span className={styles.nudgeIcon} aria-hidden="true">
              <Icon name="family" size={22} />
            </span>
            <div className={styles.nudgeText}>
              <p className={styles.nudgeTitle}>Make it theirs</p>
              <p>Add your kids, and each day’s meditation will fit their age and what they love.</p>
              <Button variant="secondary" icon="plus" onClick={addFamily}>
                Add your family
              </Button>
            </div>
          </div>
        )}
      </div>

      {featured && (
        <article className={styles.featured} aria-labelledby="today-title">
          <div className={styles.featuredTop}>
            <span className={styles.featuredOrb} aria-hidden="true">
              <span>{featured.emoji}</span>
            </span>
            {featuredDone && (
              <span className={styles.doneBadge}>
                <Icon name="check" size={16} strokeWidth={3} />
                Done today
              </span>
            )}
          </div>
          <p className={styles.featuredEyebrow}>{eyebrow}</p>
          <h2 id="today-title" ref={featuredHeading} tabIndex={-1} className={styles.featuredTitle}>
            {featured.title}
          </h2>
          <p className={styles.featuredMeta}>
            <span>{featured.theme}</span>
            <span aria-hidden="true">·</span>
            <span className={styles.metaTime}>
              <Icon name="clock" size={15} />
              <Minutes n={minutesOf(featured)} />
            </span>
          </p>
          <p className={styles.featuredIntro}>{featured.intro}</p>
          {youngest !== undefined && youngest < 2 ? (
            <p className={styles.reason}>
              <Icon name="heart" size={16} />
              <span>With a baby, keep it simple: hold them close and breathe slowly. Your calm helps them settle.</span>
            </p>
          ) : (
            reason && (
              <p className={styles.reason}>
                <Icon name="sparkle" size={16} />
                <span>{reason}</span>
              </p>
            )
          )}
          <button type="button" className={styles.start} onClick={() => start(featured)}>
            <Icon name="play" size={22} />
            <span>
              {featuredDone ? 'Start again' : 'Start'}
              <span className="visually-hidden"> {featured.title}</span>
            </span>
          </button>
        </article>
      )}

      {more.length > 0 && (
        <Section title="More to try" hint={moreHint} id="more">
          <ul className={styles.list}>
            {shown.map((meditation) => {
              const done = doneToday(sessions, today, meditation.id);
              return (
                <li key={meditation.id}>
                  <button type="button" className={styles.row} onClick={() => start(meditation)}>
                    <span className={styles.rowEmoji} aria-hidden="true">
                      {meditation.emoji}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        <span className="visually-hidden">Start </span>
                        {meditation.title}
                      </span>
                      <span className={styles.rowMeta}>
                        {meditation.theme} · <Minutes n={minutesOf(meditation)} />
                        {together && meditation.ages && (
                          <>
                            {' · '}
                            <span className={styles.rowAges}>Ages {formatRange(meditation.ages)}</span>
                          </>
                        )}
                      </span>
                    </span>
                    {done && (
                      <span className={styles.rowDone}>
                        <Icon name="check" size={16} strokeWidth={3} />
                        <span className="visually-hidden">Done today</span>
                      </span>
                    )}
                    <span className={styles.rowPlay} aria-hidden="true">
                      <Icon name="play" size={16} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {more.length > MORE_SHOWN && (
            <div className={styles.moreToggle}>
              <Button variant="ghost" aria-expanded={showAll} onClick={() => setShowAll((all) => !all)}>
                {showAll ? 'Show fewer' : `Show ${more.length - MORE_SHOWN} more`}
              </Button>
            </div>
          )}
        </Section>
      )}

      {todaysPowerup && (
        <Section title="Today’s Powerup" hint="Ideas from child psychology, for the tricky bits" id="powerup">
          <a className={styles.powerup} href={routeHash({ tab: 'powerups', powerup: todaysPowerup.powerup.id })}>
            <span className={styles.bolt} aria-hidden="true">
              <Icon name="bolt" size={22} />
            </span>
            <span className={styles.powerupText}>
              {todaysPowerup.kid && <span className={styles.powerupFor}>For {todaysPowerup.kid.name}</span>}
              <span className={styles.powerupTitle}>{todaysPowerup.powerup.title}</span>
              <span className={styles.powerupTagline}>{todaysPowerup.powerup.tagline}</span>
              <span className={styles.approach}>
                <Icon name="shield" size={15} />
                <span>{todaysPowerup.powerup.approach}</span>
              </span>
            </span>
            <span className={styles.chevron} aria-hidden="true">
              <Icon name="chevron-right" size={20} />
            </span>
          </a>
        </Section>
      )}

      {playing && <Player meditation={playing.meditation} kidIds={playing.kidIds} onClose={() => setPlaying(null)} />}
    </Screen>
  );
}
