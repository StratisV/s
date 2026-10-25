import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceTimeZone, longDay, todayIn } from '../../lib/logic/dates';
import { goalsProgress, weekDates } from '../../lib/logic/goals';
import type { PublicGoals } from '../../lib/types';
import { Hero } from '../../ui/Hero';
import { CheckIcon } from '../../ui/icons';
import styles from './PublicGoals.module.css';

/** While the page is in view and in use, it asks again this often (the edge keeps answers a minute). */
export const PUBLIC_REFRESH_MS = 60_000;
/** No tap, key or scroll for this long: no more asking until someone uses the page again. */
export const PUBLIC_IDLE_MS = 15 * 60_000;

export const INACTIVE_TITLE = 'This link is no longer active';
export const INACTIVE_TEXT = 'Ask whoever shared it for a new one.';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; view: PublicGoals }
  | { kind: 'inactive' }
  | { kind: 'error' };

interface PublicGoalsPageProps {
  /** The token from the page's address (`?goals=`). */
  token: string;
  /** Backend.publicGoals: no sign-in needed. */
  read(token: string): Promise<PublicGoals | null>;
}

/**
 * The public link's page (`<app>/?goals=<token>`; docs/ARCHITECTURE.md "Goals for the week"),
 * for anyone, signed in or not: the hero (the house in its garden under London's sky), "Goals
 * for the week" and the week's days on it, then each goal with its tick and who is on it (first
 * name and emoji). Nothing else of the home. It asks again when it comes back into view and
 * every minute while in use, so it always shows the current week. A link that was turned off
 * (or never was) says so calmly; no connection offers Try Again.
 */
export function PublicGoalsPage({ token, read }: PublicGoalsPageProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const readRef = useRef(read);
  readRef.current = read;

  const load = useCallback(async () => {
    try {
      const view = await readRef.current(token);
      setState(view ? { kind: 'ready', view } : { kind: 'inactive' });
    } catch {
      // A refresh that fails keeps what is shown; only a first load says it couldn't.
      setState((s) => (s.kind === 'ready' ? s : { kind: 'error' }));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Again when the page comes back into view, and every minute while it is in use.
  useEffect(() => {
    let lastInput = Date.now();
    const used = () => {
      lastInput = Date.now();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput < PUBLIC_IDLE_MS) void load();
    }, PUBLIC_REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      used();
      void load();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, used, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, used, { capture: true });
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, [load]);

  // Its own title, and kept out of search engines (the link is for the people it was sent to).
  useEffect(() => {
    const before = document.title;
    document.title = 'Goals for the week';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => {
      document.title = before;
      robots.remove();
    };
  }, []);

  const today = todayIn(deviceTimeZone());
  const dates = state.kind === 'ready' ? weekDates(state.view.week, today) : null;

  return (
    <div className={styles.page} data-public-goals={state.kind}>
      <main className={styles.column}>
        <Hero>
          <div className={styles.heroNav}>
            <time className={styles.eyebrow} dateTime={today}>
              {longDay(today)}
            </time>
          </div>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Goals for the week</h1>
            {dates ? <span className={styles.subtitle}>{dates}</span> : null}
          </div>
        </Hero>

        <div className={styles.body}>
          {state.kind === 'loading' ? (
            <div className={styles.card} aria-busy="true" aria-label="Loading">
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeletonRow}>
                  <span className={styles.skeletonTick} />
                  <span className={styles.skeletonLine} style={{ width: `${70 - i * 14}%` }} />
                </div>
              ))}
            </div>
          ) : state.kind === 'inactive' ? (
            <div className={`${styles.card} ${styles.message}`} role="status">
              <h2 className={styles.messageTitle}>{INACTIVE_TITLE}</h2>
              <p className={styles.messageText}>{INACTIVE_TEXT}</p>
            </div>
          ) : state.kind === 'error' ? (
            <div className={`${styles.card} ${styles.message}`} role="alert">
              <h2 className={styles.messageTitle}>Couldn’t load the goals</h2>
              <p className={styles.messageText}>Check your connection and try again.</p>
              <button
                type="button"
                className={styles.retry}
                onClick={() => {
                  setState({ kind: 'loading' });
                  void load();
                }}
              >
                Try Again
              </button>
            </div>
          ) : (
            <Goals view={state.view} />
          )}
          <p className={styles.footer}>
            {state.kind === 'inactive' ? 'Shared from home.os.' : 'Shared from home.os. This page keeps itself up to date.'}
          </p>
        </div>
      </main>
    </div>
  );
}

/** This week's goals: how many are done, then each with its tick and who is on it. */
function Goals({ view }: { view: PublicGoals }) {
  const { done, total } = goalsProgress(view.goals);
  if (!total) {
    return (
      <div className={`${styles.card} ${styles.message}`}>
        <h2 className={styles.messageTitle}>Nothing planned yet</h2>
        <p className={styles.messageText}>Goals added this week will show here.</p>
      </div>
    );
  }
  const all = done === total;
  return (
    <section className={styles.card} aria-label="This week’s goals">
      <div className={styles.progress} data-all={all || undefined}>
        <span className={styles.progressText} data-public-progress="">
          {all ? (total === 1 ? 'Done' : `All ${total} done`) : `${done} of ${total} done`}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.fill} style={{ width: `${(done / total) * 100}%` }} />
        </span>
      </div>
      <ul className={styles.list} data-public-list="">
        {view.goals.map((goal, i) => (
          <li key={i} className={styles.row} data-done={goal.done || undefined}>
            <span className={styles.tick} role="img" aria-label={goal.done ? 'Done' : 'Not done yet'}>
              <CheckIcon className={styles.check} size={14} strokeWidth={3.2} />
            </span>
            <span className={styles.text}>
              <span className={styles.goalTitle}>{goal.title}</span>
              {goal.person ? (
                <span className={styles.who} data-public-who="">
                  <span aria-hidden="true">{goal.person.emoji}</span> {goal.person.name}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
