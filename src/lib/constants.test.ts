import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOUSEKEEPING_DEMO_NOTE,
  HOUSEKEEPING_DEMO_VISITS,
  HOUSEKEEPING_PRICE_MAX_PENCE,
  HOUSEKEEPING_STARTER_TASKS,
  QUICK_REACTIONS,
  REACTION_EMOJIS,
  TEXT_LIMITS,
} from './constants';

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

describe('housekeeping', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261010000400_housekeeping.sql', import.meta.url), 'utf8');

  it('starter tasks match housekeeping_starter_tasks() in the migration, in order', () => {
    const fn = /function public\.housekeeping_starter_tasks\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    expect(fn, 'housekeeping_starter_tasks() in the housekeeping migration').not.toBeNull();
    const inMigration = [...fn![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inMigration).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
  });

  it('limits match the check constraints', () => {
    expect(sql).toContain('housekeeping_notes_body_length check (length(body) <= 4000)');
    expect(TEXT_LIMITS.housekeepingNote).toBe(4000);
    expect(sql).toContain('housekeeping_tasks_title_length check (length(title) between 1 and 200)');
    expect(TEXT_LIMITS.housekeepingTask).toBe(200);
    expect(sql).toContain('housekeeping_visits_comments_length check (length(comments) <= 4000)');
    expect(TEXT_LIMITS.housekeepingComments).toBe(4000);
    expect(sql).toContain(`price_pence between 0 and ${HOUSEKEEPING_PRICE_MAX_PENCE}`);
  });

  it('the demo seed is well formed: past Thursdays, starter titles, prices in range', () => {
    const weeks = HOUSEKEEPING_DEMO_VISITS.map((v) => v.weeksBack);
    expect(new Set(weeks).size).toBe(weeks.length);
    for (const visit of HOUSEKEEPING_DEMO_VISITS) {
      expect(visit.weeksBack).toBeGreaterThanOrEqual(0);
      for (const title of visit.done) expect(HOUSEKEEPING_STARTER_TASKS).toContain(title);
      expect(new Set(visit.done).size).toBe(visit.done.length);
      if (visit.price_pence !== null) {
        expect(Number.isInteger(visit.price_pence)).toBe(true);
        expect(visit.price_pence).toBeGreaterThanOrEqual(0);
        expect(visit.price_pence).toBeLessThanOrEqual(HOUSEKEEPING_PRICE_MAX_PENCE);
      }
      expect(visit.comments.length).toBeLessThanOrEqual(TEXT_LIMITS.housekeepingComments);
      expect(visit.note.length).toBeLessThanOrEqual(TEXT_LIMITS.housekeepingNote);
    }
    expect(HOUSEKEEPING_DEMO_NOTE.body.length).toBeGreaterThan(0);
    expect(HOUSEKEEPING_DEMO_NOTE.daysBack).toBeGreaterThanOrEqual(0);
  });
});
