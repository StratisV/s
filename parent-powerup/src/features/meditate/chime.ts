/*
 * A soft bell at the start and end of a meditation, made with the Web Audio API: a few sine
 * tones struck gently and left to fade. Where audio is missing or blocked it stays silent and
 * never throws.
 */

type AudioContextClass = new () => AudioContext;

function audioContextClass(): AudioContextClass | undefined {
  const g = globalThis as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return g.AudioContext ?? g.webkitAudioContext;
}

export interface Chime {
  play: (kind: 'start' | 'end') => void;
  /** Lets go of the audio, after the last bell has rung out. */
  close: () => void;
}

/** How long a bell rings, in seconds. */
const RING = 3.2;

function bell(ctx: AudioContext, at: number, frequency: number, peak: number) {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(peak, at + 0.03);
  out.gain.exponentialRampToValueAtTime(0.0001, at + RING);
  out.connect(ctx.destination);
  // The note, and two quiet overtones that give it a bell's shimmer.
  for (const [ratio, level] of [
    [1, 1],
    [2.01, 0.22],
    [3.02, 0.06],
  ]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * ratio, at);
    gain.gain.setValueAtTime(level, at);
    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + RING + 0.1);
  }
}

export function createChime(): Chime {
  let ctx: AudioContext | null = null;

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = audioContextClass();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  return {
    play(kind) {
      try {
        const c = ensure();
        if (!c) return;
        if (c.state === 'suspended') c.resume?.().catch(() => undefined);
        const at = c.currentTime + 0.05;
        if (kind === 'start') {
          bell(c, at, 528, 0.12);
        } else {
          bell(c, at, 660, 0.1);
          bell(c, at + 0.5, 528, 0.1);
        }
      } catch {
        // No sound this time; the meditation carries on.
      }
    },
    close() {
      try {
        ctx?.close?.().catch(() => undefined);
      } catch {
        // Already closed.
      }
      ctx = null;
    },
  };
}
