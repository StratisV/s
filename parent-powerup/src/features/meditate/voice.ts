import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Voice guidance: the browser reads each step aloud (the Web Speech API), in a British voice
 * when the phone has one. Not every browser can speak; the toggle only shows where it can.
 */

export const VOICE_KEY = 'parent-powerup:voice';

export function readVoicePref(): boolean {
  try {
    return globalThis.localStorage?.getItem(VOICE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveVoicePref(on: boolean) {
  try {
    globalThis.localStorage?.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}

export function speechSupported(): boolean {
  const g = globalThis as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };
  return typeof g.speechSynthesis === 'object' && g.speechSynthesis !== null && typeof g.SpeechSynthesisUtterance === 'function';
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'default'>;

const langOf = (voice: VoiceLike) => voice.lang.replace('_', '-').toLowerCase();
/** The better voices browsers offer often say so in their name. */
const quality = (voice: VoiceLike) => (/natural|neural|enhanced|premium/i.test(voice.name) ? 0 : 1) + (voice.default ? 0 : 0.5);

/** A British English voice if there is one (the best sounding first), else any English one. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | undefined {
  const british = voices.filter((v) => langOf(v) === 'en-gb');
  if (british.length) return british.slice().sort((a, b) => quality(a) - quality(b))[0];
  return voices.find((v) => langOf(v).startsWith('en'));
}

/** How fast the voice reads: a little slower than normal, for a calm pace. */
export const VOICE_RATE = 0.9;

export interface Voice {
  supported: boolean;
  on: boolean;
  setOn: (on: boolean) => void;
  speak: (text: string) => void;
  cancel: () => void;
  /** Whether it is reading something right now. */
  speaking: () => boolean;
}

export function useVoice(): Voice {
  const [supported] = useState(speechSupported);
  const [on, setOnState] = useState(() => supported && readVoicePref());
  const chosen = useRef<SpeechSynthesisVoice | undefined>(undefined);

  useEffect(() => {
    if (!supported) return;
    const synth = globalThis.speechSynthesis;
    const load = () => {
      try {
        chosen.current = pickVoice(synth.getVoices());
      } catch {
        chosen.current = undefined;
      }
    };
    load();
    // Voices often arrive a moment after the page loads.
    synth.addEventListener?.('voiceschanged', load);
    return () => {
      synth.removeEventListener?.('voiceschanged', load);
      try {
        synth.cancel();
      } catch {
        // Nothing to stop.
      }
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    try {
      globalThis.speechSynthesis.cancel();
    } catch {
      // Nothing to stop.
    }
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      try {
        const synth = globalThis.speechSynthesis;
        if (synth.speaking || synth.pending) synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-GB';
        utterance.rate = VOICE_RATE;
        if (chosen.current) utterance.voice = chosen.current;
        synth.speak(utterance);
      } catch {
        // Speech failed: the words are still on screen.
      }
    },
    [supported],
  );

  const speaking = useCallback(() => {
    if (!supported) return false;
    try {
      return globalThis.speechSynthesis.speaking;
    } catch {
      return false;
    }
  }, [supported]);

  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      saveVoicePref(next);
      if (!next) cancel();
    },
    [cancel],
  );

  return { supported, on: supported && on, setOn, speak, cancel, speaking };
}
