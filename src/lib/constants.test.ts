import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUICK_REACTIONS, REACTION_EMOJIS } from './constants';

describe('reaction emoji', () => {
  it('match the database check message_reactions_emoji_allowed, code point for code point', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20261010000100_chat.sql', import.meta.url), 'utf8');
    const check = /add constraint message_reactions_emoji_allowed check \(\s*emoji = any \(array\[([\s\S]*?)\]::text\[\]\)/.exec(sql);
    expect(check, 'the allowlist constraint in the chat migration').not.toBeNull();
    const inMigration = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inMigration).toEqual([...REACTION_EMOJIS]);
  });

  it('are distinct, and the quick reactions are among them', () => {
    expect(new Set(REACTION_EMOJIS).size).toBe(REACTION_EMOJIS.length);
    for (const emoji of QUICK_REACTIONS) expect(REACTION_EMOJIS).toContain(emoji);
  });
});
