import { createChime } from './chime';
import { pickVoice, readVoicePref, saveVoicePref, speechSupported } from './voice';
import { FEELINGS, greeting, longDate, possessive, streakWords } from './words';

describe('words', () => {
  it('writes the date the British way', () => {
    expect(longDate('2026-11-15')).toBe('Sunday 15 November');
    expect(longDate('2027-01-01')).toBe('Friday 1 January');
  });

  it('greets by the time of day, with a first name', () => {
    expect(greeting(8, 'Sam Jones')).toBe('Good morning, Sam');
    expect(greeting(14, '')).toBe('Good afternoon');
    expect(greeting(20, '  Priya ')).toBe('Good evening, Priya');
    expect(greeting(3)).toBe('Hello');
  });

  it('counts the streak kindly', () => {
    expect(streakWords(1)).toBe('1 day so far');
    expect(streakWords(3)).toBe('3 days in a row');
    expect(possessive('Mia')).toBe('Mia’s');
  });

  it('offers three feelings, gentlest first, and never a dash', () => {
    expect(FEELINGS.map((f) => f.value)).toEqual([1, 2, 3]);
    FEELINGS.forEach((f) => expect(`${f.label} ${f.reply}`).not.toMatch(/[–—]/));
  });
});

describe('voice', () => {
  const voice = (name: string, lang: string, isDefault = false) => ({ name, lang, default: isDefault });

  it('prefers a British voice, and the better sounding one', () => {
    const voices = [voice('Alex', 'en-US', true), voice('Daniel', 'en-GB'), voice('Serena (Enhanced)', 'en_GB'), voice('Amélie', 'fr-FR')];
    expect(pickVoice(voices)?.name).toBe('Serena (Enhanced)');
    expect(pickVoice([voice('Daniel', 'en-GB'), voice('Kate', 'en-GB', true)])?.name).toBe('Kate');
  });

  it('falls back to any English voice, or none', () => {
    expect(pickVoice([voice('Amélie', 'fr-FR'), voice('Alex', 'en-US')])?.name).toBe('Alex');
    expect(pickVoice([voice('Amélie', 'fr-FR')])).toBeUndefined();
    expect(pickVoice([])).toBeUndefined();
  });

  it('does without speech or storage', () => {
    expect(speechSupported()).toBe(false);
    expect(readVoicePref()).toBe(false);
    expect(() => saveVoicePref(true)).not.toThrow();
  });
});

describe('chime', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays silent, without throwing, where there is no audio', () => {
    const chime = createChime();
    expect(() => chime.play('start')).not.toThrow();
    expect(() => chime.close()).not.toThrow();
  });

  it('stays silent where audio is blocked', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Not allowed');
        }
      },
    );
    expect(() => createChime().play('end')).not.toThrow();
  });

  it('strikes soft sine tones that fade away', () => {
    const oscillators: { type: string; started: number; stopped: number }[] = [];
    const ramps: number[] = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime: (v: number) => ramps.push(v) });
    class FakeContext {
      state = 'suspended';
      currentTime = 1;
      destination = {};
      resume = vi.fn(() => Promise.resolve());
      close = vi.fn(() => Promise.resolve());
      createGain() {
        return { gain: param(), connect() {} };
      }
      createOscillator() {
        const osc = {
          type: '',
          frequency: param(),
          started: 0,
          stopped: 0,
          connect() {},
          start(at: number) {
            osc.started = at;
          },
          stop(at: number) {
            osc.stopped = at;
          },
        };
        oscillators.push(osc);
        return osc;
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const chime = createChime();
    chime.play('start');
    expect(oscillators.length).toBeGreaterThan(0);
    oscillators.forEach((o) => {
      expect(o.type).toBe('sine');
      expect(o.stopped).toBeGreaterThan(o.started);
    });
    // Gently up, then faded to (almost) nothing.
    expect(Math.max(...ramps)).toBeLessThanOrEqual(0.2);
    expect(Math.min(...ramps)).toBeLessThan(0.001);
    chime.play('end');
    expect(oscillators.length).toBeGreaterThan(3);
    chime.close();
  });
});
