import type { CSSProperties, ReactNode } from 'react';
import { DUCK_URL, HEDGEHOG_URL } from './animals';
import styles from './EmojiText.module.css';

/** The emoji the household draws itself, so they keep their colours whatever the phone's emoji font. */
const DRAWN: Record<string, string> = { '🦆': DUCK_URL, '🦔': HEDGEHOG_URL };
const SPLIT = /(🦆|🦔)/u;

/**
 * Text with the household's own green duck and brown hedgehog in place of the
 * system 🦆 and 🦔 (on iPhone a brown mallard and a grey-brown hedgehog). The
 * emoji character stays in the text, invisible, so copying, find-in-page and
 * screen readers still get "🦆"; the drawing is its background.
 */
export function EmojiText({ text }: { text: string }): ReactNode {
  if (!SPLIT.test(text)) return text;
  return text.split(SPLIT).map((part, i) => {
    const url = DRAWN[part];
    if (!url) return part;
    return (
      <span
        key={i}
        className={styles.drawn}
        style={{ '--drawn': `url("${url}")` } as CSSProperties}
        data-drawn={part === '🦆' ? 'duck' : 'hedgehog'}
      >
        <span className={styles.glyph}>{part}</span>
      </span>
    );
  });
}
