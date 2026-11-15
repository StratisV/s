import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dateKey } from '../../lib/dates';
import { actions } from '../../lib/store';
import type { Meditation } from '../../types';
import { Icon } from '../../ui/Icon';
import { createChime } from './chime';
import { breathAt, type BreathPhase, clockText, clockWords, locate, totalMs } from './timing';
import { useSession } from './useSession';
import { useVoice } from './voice';
import { useWakeLock } from './useWakeLock';
import { FEELINGS, type Feeling } from './words';
import styles from './Player.module.css';

interface PlayerProps {
  meditation: Meditation;
  /** The kids joining (together), for the log and the words at the end. */
  kidIds: string[];
  onClose: () => void;
}

const CUES: Record<BreathPhase, string> = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out', rest: 'Rest' };

/** The progress ring's circumference (r = 48 in a 100 box). */
const RING = 2 * Math.PI * 48;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The meditation room: a full-screen, night-coloured overlay with a breathing circle to follow,
 * the words of each step, and gentle controls. It logs the session when it finishes.
 */
export function Player({ meditation, kidIds, onClose }: PlayerProps) {
  const titleId = useId();
  const { steps } = meditation;
  const total = useMemo(() => totalMs(steps) || 1, [steps]);
  const voice = useVoice();
  const chime = useMemo(createChime, []);
  const room = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const endHeading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const voiceOn = useRef(voice.on);
  voiceOn.current = voice.on;
  const logged = useRef(false);
  /** The voice was cut off (by a pause, or a skip while paused) and should read the step again. */
  const unread = useRef(false);
  const smooth = useRef({ value: 0, at: 0 });
  const [feeling, setFeeling] = useState<Feeling | null>(null);

  const session = useSession(steps, {
    onStep: (index, running) => {
      if (running && voiceOn.current) voice.speak(steps[index].text);
      else unread.current = !running;
    },
    onPause: () => {
      unread.current = unread.current || voice.speaking();
      voice.cancel();
    },
    onResume: (index) => {
      if (unread.current && voiceOn.current) voice.speak(steps[index].text);
      unread.current = false;
    },
    onFinish: () => {
      if (!logged.current) {
        logged.current = true;
        actions.logSession({ date: dateKey(), meditationId: meditation.id, mode: meditation.mode, kidIds });
      }
      chime.play('end');
      if (voiceOn.current) voice.speak('Well done.');
    },
    onFrame: (elapsed) => {
      // The circle follows the breath, eased so a skip or a step change never jolts it.
      const at = locate(steps, elapsed);
      const step = steps[at.index];
      const target = step?.breath && !at.done ? breathAt(step.breath, at.inStep).value : 0;
      const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = t - smooth.current.at;
      smooth.current.at = t;
      const k = dt > 1000 || dt <= 0 ? 1 : 1 - Math.exp(-dt / 160);
      smooth.current.value += (target - smooth.current.value) * k;
      stage.current?.style.setProperty('--breath', smooth.current.value.toFixed(4));
      ring.current?.setAttribute('stroke-dashoffset', String(RING * (1 - Math.min(elapsed / total, 1))));
    },
  });

  useWakeLock(!session.done);

  // The opening bell; the audio is let go once the closing bell has rung out.
  useEffect(() => {
    chime.play('start');
    return () => {
      setTimeout(() => chime.close(), 4000);
    };
  }, [chime]);

  // A modal room: focus inside, the page behind it still and out of reach, Escape to leave.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    playButton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const app = document.getElementById('root');
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      const node = room.current;
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (app) app.inert = wasInert;
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (session.done) endHeading.current?.focus();
  }, [session.done]);

  const at = locate(steps, session.elapsed);
  const step = steps[session.index] ?? steps[0];
  const breath = step?.breath && !session.done ? breathAt(step.breath, at.inStep) : null;
  const left = session.total - session.elapsed;
  const together = meditation.mode === 'together';

  const toggleVoice = () => {
    const next = !voice.on;
    voice.setOn(next);
    // Read the current step straight away, from the tap itself (some phones only speak after one).
    if (next && session.running && step) voice.speak(step.text);
  };

  const rate = (value: Feeling) => {
    setFeeling(value);
    actions.rateLastSession(value);
  };

  const question = !together ? 'How do you feel now?' : kidIds.length > 1 ? 'How does everyone feel now?' : 'How do you both feel now?';
  const reply = FEELINGS.find((f) => f.value === feeling)?.reply;

  return createPortal(
    <div ref={room} className={styles.room} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.inner}>
        <header className={styles.top}>
          <button type="button" className={styles.round} onClick={() => close.current()} aria-label="Close">
            <Icon name="close" size={22} />
          </button>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>{together ? 'Together' : 'Just for you'}</p>
            <h2 id={titleId} className={styles.title}>
              {meditation.title}
            </h2>
          </div>
          {voice.supported ? (
            <button
              type="button"
              className={styles.round}
              aria-pressed={voice.on}
              aria-label="Read aloud"
              title={voice.on ? 'Voice on' : 'Voice off'}
              onClick={toggleVoice}
            >
              <Icon name={voice.on ? 'voice' : 'voice-off'} size={22} />
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </header>

        {!session.done ? (
          <>
            <div
              ref={stage}
              className={styles.stage}
              data-resting={breath ? undefined : true}
              data-paused={session.running ? undefined : true}
              aria-hidden="true"
            >
              <span className={styles.halo} />
              <span className={styles.orb} />
              <svg className={styles.ring} viewBox="0 0 100 100" focusable="false">
                <circle className={styles.ringTrack} cx="50" cy="50" r="48" />
                <circle
                  ref={ring}
                  className={styles.ringFill}
                  cx="50"
                  cy="50"
                  r="48"
                  strokeDasharray={RING}
                  strokeDashoffset={RING}
                />
              </svg>
              <span className={styles.cue}>
                {breath ? (
                  <>
                    <span className={styles.cueWord}>{CUES[breath.phase]}</span>
                    <span className={styles.cueCount}>{breath.count}</span>
                  </>
                ) : (
                  <span className={styles.cueEmoji}>{meditation.emoji}</span>
                )}
              </span>
            </div>

            <div className={styles.words}>
              <p key={session.index} className={styles.stepText} aria-live="polite" aria-atomic="true">
                {step?.text}
              </p>
            </div>

            <p className={styles.meta}>
              <span>
                Step {session.index + 1} of {steps.length}
              </span>
              <span aria-hidden="true"> · </span>
              <span
                role="timer"
                aria-live="off"
                aria-label={`${clockWords(left)} left`}
              >
                {clockText(left)} left
              </span>
              {!session.running && <span className={styles.pausedNote}> · Paused</span>}
            </p>

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.skip}
                onClick={session.previous}
                disabled={session.index === 0}
                aria-label="Previous step"
              >
                <Icon name="chevron-left" size={26} />
              </button>
              <button
                ref={playButton}
                type="button"
                className={styles.play}
                onClick={session.toggle}
                aria-label={session.running ? 'Pause' : 'Resume'}
              >
                <Icon name={session.running ? 'pause' : 'play'} size={30} strokeWidth={session.running ? 3 : undefined} />
              </button>
              <button
                type="button"
                className={styles.skip}
                onClick={session.next}
                disabled={session.index >= steps.length - 1}
                aria-label="Next step"
              >
                <Icon name="chevron-right" size={26} />
              </button>
            </div>

            <div className={styles.finishSlot}>
              {session.canFinish && (
                <button type="button" className={styles.finish} onClick={session.finish}>
                  <Icon name="check" size={18} />
                  <span>Finish</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <section className={styles.end} aria-labelledby={`${titleId}-done`}>
            <div className={styles.endOrb} aria-hidden="true">
              <span>{meditation.emoji}</span>
            </div>
            <h3 id={`${titleId}-done`} ref={endHeading} tabIndex={-1} className={styles.endTitle}>
              {!together ? 'Well done' : kidIds.length > 1 ? 'Well done, all of you' : 'Well done, you two'}
            </h3>
            <p className={styles.endLine}>
              {together ? 'You took a few calm minutes together.' : 'You gave yourself a few calm minutes.'}
            </p>

            <div className={styles.checkin} role="group" aria-labelledby={`${titleId}-q`}>
              <p id={`${titleId}-q`} className={styles.question}>
                {question}
              </p>
              <div className={styles.feelings}>
                {FEELINGS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={styles.feeling}
                    aria-pressed={feeling === f.value}
                    onClick={() => rate(f.value)}
                  >
                    <span className={styles.feelingEmoji} aria-hidden="true">
                      {f.emoji}
                    </span>
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
              <p className={styles.reply} role="status">
                {reply ?? ''}
              </p>
            </div>

            <button type="button" className={styles.doneButton} onClick={() => close.current()}>
              Done
            </button>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
