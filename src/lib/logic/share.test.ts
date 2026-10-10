import { describe, expect, it } from 'vitest';
import type { Area, Item, Member, Repeat } from '../types';
import {
  areaShareMessage,
  clipText,
  itemShareMessage,
  linkUrl,
  parseSharedLink,
  SHARE_AREA_MAX,
  SHARE_NOTE_MAX,
  tidyText,
  type ShareContext,
} from './share';

const TODAY = '2026-10-08'; // Thursday
const BASE = 'https://home.example/';

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    household_id: 'h1',
    area_id: 'a-hall',
    kind: 'task',
    title: 'Item',
    note: '',
    good: '',
    rag: 'amber',
    due_date: '2026-10-20',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function member(over: Partial<Member>): Member {
  return {
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    name: 'Someone',
    email: '',
    emoji: '🦔',
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const SHEA = member({ id: 'm-shea', name: 'Shea', emoji: '🦆' });
const ELA = member({ id: 'm-ela', name: 'Ela', emoji: '🦊' });

const area = (id: string, name: string, position = 0): Area => ({ id, household_id: 'h1', name, position });
const HALLWAY = area('a-hall', 'Hallway');
const KITCHEN = area('a-kitchen', 'Kitchen', 1);
const GARDEN = area('a-garden', 'Garden', 2);
const AREAS = [HALLWAY, KITCHEN, GARDEN];

const CTX: ShareContext = { members: [SHEA, ELA], today: TODAY, timeZone: 'Europe/London', baseUrl: BASE };

const lines = (text: string) => text.split('\n');

describe('itemShareMessage: To do', () => {
  it('a missed task: title, area, status and the day it was due, who, note, then the link', () => {
    const heaters = item({
      id: 'i-heat',
      title: 'Heaters not working',
      note: 'No heat since the weekend. Engineer needs booking.',
      rag: 'red',
      due_date: '2026-10-06',
      assignee_id: SHEA.id,
    });
    expect(itemShareMessage(heaters, AREAS, CTX)).toEqual({
      title: 'Heaters not working',
      text: [
        'Heaters not working',
        'Hallway · Red · Missed · Tue 6 Oct',
        'Assigned to Shea',
        'No heat since the weekend. Engineer needs booking.',
        '',
        'https://home.example/?item=i-heat',
      ].join('\n'),
    });
  });

  it('a task due later says when it is due', () => {
    const oil = item({ title: 'Olive oil', area_id: KITCHEN.id, rag: 'green', due_date: '2026-11-13', assignee_id: ELA.id });
    expect(lines(itemShareMessage(oil, AREAS, CTX).text).slice(0, 3)).toEqual([
      'Olive oil',
      'Kitchen · Green · Due Fri 13 Nov',
      'Assigned to Ela',
    ]);
  });

  it('due today is not missed', () => {
    const today = item({ due_date: TODAY });
    expect(lines(itemShareMessage(today, AREAS, CTX).text)[1]).toBe('Hallway · Amber · Due Thu 8 Oct');
  });

  it('a date in another year carries the year', () => {
    const later = item({ due_date: '2027-01-05' });
    expect(lines(itemShareMessage(later, AREAS, CTX).text)[1]).toBe('Hallway · Amber · Due Tue 5 Jan 2027');
  });

  it.each<[Repeat, string]>([
    ['weekly', 'Every week'],
    ['monthly', 'Every month'],
    ['quarterly', 'Every 3 months'],
    ['biannual', 'Every 6 months'],
    ['yearly', 'Every year'],
  ])('a %s repeat reads "%s" after the date', (repeat, label) => {
    const repeating = item({ repeat, due_date: '2026-11-13', rag: 'green' });
    expect(lines(itemShareMessage(repeating, AREAS, CTX).text)[1]).toBe(`Hallway · Green · Due Fri 13 Nov · ${label}`);
  });

  it('a repeat without a due date still shows', () => {
    const repeating = item({ repeat: 'monthly', due_date: null });
    expect(lines(itemShareMessage(repeating, AREAS, CTX).text)[1]).toBe('Hallway · Amber · Every month');
  });

  it('no due date: just the area and status', () => {
    const undated = item({ title: 'Mirror lights not level', due_date: null, area_id: 'a-kitchen' });
    expect(lines(itemShareMessage(undated, AREAS, CTX).text)[1]).toBe('Kitchen · Amber');
  });

  it('unassigned, or looked after by someone who has left: "Unassigned"', () => {
    expect(lines(itemShareMessage(item({ assignee_id: null }), AREAS, CTX).text)[2]).toBe('Unassigned');
    expect(lines(itemShareMessage(item({ assignee_id: 'm-gone' }), AREAS, CTX).text)[2]).toBe('Unassigned');
  });

  it('uses the name without the emoji', () => {
    const { text } = itemShareMessage(item({ assignee_id: SHEA.id }), AREAS, CTX);
    expect(text).toContain('Assigned to Shea');
    expect(text).not.toContain('🦆');
  });

  it('no note: no empty line before the link but the one', () => {
    const { text } = itemShareMessage(item({ id: 'x', title: 'Fix the gate' }), AREAS, CTX);
    expect(text).toBe('Fix the gate\nHallway · Amber · Due Tue 20 Oct\nUnassigned\n\nhttps://home.example/?item=x');
  });

  it('an area that is gone is left out', () => {
    expect(lines(itemShareMessage(item({ area_id: 'a-gone' }), AREAS, CTX).text)[1]).toBe('Amber · Due Tue 20 Oct');
  });

  it('a task never shows "What good looks like" (it keeps it for when it is To maintain)', () => {
    const { text } = itemShareMessage(item({ good: 'Spotless' }), AREAS, CTX);
    expect(text).not.toContain('What good looks like');
    expect(text).not.toContain('Spotless');
  });

  it('the title and note are tidied', () => {
    const messy = item({ title: '  Fix the gate ', note: '  Latch  sticks.\n\n\n  Needs   oil. \n' });
    const message = itemShareMessage(messy, AREAS, CTX);
    expect(message.title).toBe('Fix the gate');
    expect(lines(message.text)).toEqual([
      'Fix the gate',
      'Hallway · Amber · Due Tue 20 Oct',
      'Unassigned',
      'Latch sticks.',
      'Needs oil.',
      '',
      'https://home.example/?item=i1',
    ]);
  });

  it('a long note is cut at a word with "…"', () => {
    const note = 'The engineer came on Monday and said the boiler pressure keeps dropping. '.repeat(10);
    const { text } = itemShareMessage(item({ note }), AREAS, CTX);
    const shared = lines(text)[3];
    expect(Array.from(shared).length).toBeLessThanOrEqual(SHARE_NOTE_MAX);
    expect(shared.endsWith('…')).toBe(true);
    expect(note.startsWith(shared.slice(0, -1))).toBe(true);
    // A whole word before the "…".
    expect(note.charAt(shared.length - 1)).toBe(' ');
  });

  it('the link carries the id, encoded', () => {
    const { text } = itemShareMessage(item({ id: 'a b&c' }), AREAS, CTX);
    expect(text.endsWith('\n\nhttps://home.example/?item=a%20b%26c')).toBe(true);
  });

  it('the link follows the base path', () => {
    const { text } = itemShareMessage(item({ id: 'i9' }), AREAS, { ...CTX, baseUrl: 'https://example.org/home/' });
    expect(text.endsWith('https://example.org/home/?item=i9')).toBe(true);
  });
});

describe('itemShareMessage: To maintain', () => {
  const firepit = item({
    id: 'i-fire',
    kind: 'state',
    area_id: GARDEN.id,
    title: 'Firepit',
    note: "New one installed. Keep the cover on when it's not in use.",
    good: 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.',
    rag: 'green',
    due_date: null,
    repeat: 'none',
    notify: 'none',
    assignee_id: ELA.id,
    updated_at: '2026-10-06T09:00:00.000Z',
  });

  it('when it was updated, who looks after it, its note and what good looks like', () => {
    expect(itemShareMessage(firepit, AREAS, CTX).text).toBe(
      [
        'Firepit',
        'Garden · Green · Updated Tue 6 Oct',
        'Looked after by Ela',
        "New one installed. Keep the cover on when it's not in use.",
        'What good looks like: Cover on when not in use, ash cleared out, logs dry and stacked under the bench.',
        '',
        'https://home.example/?item=i-fire',
      ].join('\n'),
    );
  });

  it('the "Updated" day is in the household time zone', () => {
    // 23:30 UTC on the 6th is half past midnight on the 7th in London (BST).
    const late = { ...firepit, updated_at: '2026-10-06T23:30:00.000Z' };
    expect(lines(itemShareMessage(late, AREAS, CTX).text)[1]).toBe('Garden · Green · Updated Wed 7 Oct');
    expect(lines(itemShareMessage(late, AREAS, { ...CTX, timeZone: 'UTC' }).text)[1]).toBe(
      'Garden · Green · Updated Tue 6 Oct',
    );
  });

  it('no date when the update time is unreadable', () => {
    const odd = { ...firepit, updated_at: 'not a date' };
    expect(lines(itemShareMessage(odd, AREAS, CTX).text)[1]).toBe('Garden · Green');
  });

  it('never a due date or repeat, whatever the row says', () => {
    const odd = { ...firepit, due_date: '2026-10-01', repeat: 'monthly' as const };
    const second = lines(itemShareMessage(odd, AREAS, CTX).text)[1];
    expect(second).toBe('Garden · Green · Updated Tue 6 Oct');
  });

  it('unassigned, and without a note or what good looks like', () => {
    const bare = { ...firepit, assignee_id: null, note: '', good: '  ' };
    expect(lines(itemShareMessage(bare, AREAS, CTX).text)).toEqual([
      'Firepit',
      'Garden · Green · Updated Tue 6 Oct',
      'Unassigned',
      '',
      'https://home.example/?item=i-fire',
    ]);
  });

  it('a long "What good looks like" is cut too', () => {
    const long = { ...firepit, good: 'Logs dry, '.repeat(60) };
    const shared = lines(itemShareMessage(long, AREAS, CTX).text).find((l) => l.startsWith('What good looks like: '))!;
    const good = shared.slice('What good looks like: '.length);
    expect(Array.from(good).length).toBeLessThanOrEqual(SHARE_NOTE_MAX);
    // 279 characters keep 27 whole "Logs dry, " and "Logs dry,": cut at the last space.
    expect(good).toBe(`${'Logs dry, '.repeat(27)}Logs…`);
  });
});

describe('areaShareMessage', () => {
  const oil = item({ id: 'oil', area_id: KITCHEN.id, title: 'Olive oil', rag: 'green', due_date: '2026-11-13' });
  const paper = item({ id: 'paper', area_id: KITCHEN.id, title: 'Kitchen paper', rag: 'green', due_date: '2026-11-05' });
  const fridge = item({
    id: 'fridge',
    area_id: KITCHEN.id,
    kind: 'state',
    title: 'Fridge',
    rag: 'amber',
    due_date: null,
    updated_at: '2026-10-06T09:00:00.000Z',
  });
  const bins = item({ id: 'bins', area_id: KITCHEN.id, title: 'Bins', rag: 'red', due_date: '2026-10-06' });
  const undated = item({ id: 'tap', area_id: KITCHEN.id, title: 'Dripping tap', due_date: null });

  it('the area and how many open items, then one line each: To do by date, then To maintain', () => {
    const elsewhere = item({ id: 'heat', area_id: HALLWAY.id, title: 'Heaters' });
    const done = item({ id: 'done', area_id: KITCHEN.id, title: 'Descale kettle', status: 'done' });
    const message = areaShareMessage(KITCHEN, [fridge, oil, elsewhere, undated, paper, done, bins], CTX);
    expect(message).toEqual({
      title: 'Kitchen',
      text: [
        'Kitchen (5 items)',
        '• Bins · Red · Missed · Tue 6 Oct',
        '• Kitchen paper · Green · Due Thu 5 Nov',
        '• Olive oil · Green · Due Fri 13 Nov',
        '• Dripping tap · Amber',
        '• Fridge · Amber · Updated Tue 6 Oct',
        '',
        'https://home.example/?area=a-kitchen',
      ].join('\n'),
    });
  });

  it('one item', () => {
    expect(lines(areaShareMessage(KITCHEN, [oil], CTX).text)[0]).toBe('Kitchen (1 item)');
  });

  it('no open items: says there is nothing to do', () => {
    const done = item({ area_id: KITCHEN.id, status: 'done' });
    expect(areaShareMessage(KITCHEN, [done, item({ area_id: HALLWAY.id })], CTX).text).toBe(
      'Kitchen\nNothing to do\n\nhttps://home.example/?area=a-kitchen',
    );
  });

  it('a list longer than SHARE_AREA_MAX ends with how many more', () => {
    const many = Array.from({ length: 25 }, (_, n) =>
      item({ id: `n${n}`, area_id: KITCHEN.id, title: `Job ${n + 1}`, due_date: `2026-11-${String(n + 1).padStart(2, '0')}` }),
    );
    const shown = lines(areaShareMessage(KITCHEN, many, CTX).text);
    expect(shown[0]).toBe('Kitchen (25 items)');
    const bullets = shown.filter((l) => l.startsWith('• '));
    expect(bullets).toHaveLength(SHARE_AREA_MAX - 1);
    expect(bullets[0]).toBe('• Job 1 · Amber · Due Sun 1 Nov');
    expect(shown[SHARE_AREA_MAX]).toBe(`…and ${25 - (SHARE_AREA_MAX - 1)} more`);
  });

  it('exactly SHARE_AREA_MAX items are all listed', () => {
    const many = Array.from({ length: SHARE_AREA_MAX }, (_, n) => item({ id: `n${n}`, area_id: KITCHEN.id, title: `Job ${n}` }));
    const shown = lines(areaShareMessage(KITCHEN, many, CTX).text);
    expect(shown.filter((l) => l.startsWith('• '))).toHaveLength(SHARE_AREA_MAX);
    expect(shown.some((l) => l.includes('more'))).toBe(false);
  });

  it('the name is trimmed and the link carries the area id', () => {
    const named = { ...KITCHEN, id: 'k 1', name: ' Kitchen ' };
    const message = areaShareMessage(named, [], CTX);
    expect(message.title).toBe('Kitchen');
    expect(message.text).toBe('Kitchen\nNothing to do\n\nhttps://home.example/?area=k%201');
  });
});

describe('tidyText and clipText', () => {
  it('squashes spaces, trims lines and drops blank ones', () => {
    expect(tidyText('  a \t b \r\n\r\n c  d  \n\n')).toBe('a b\nc d');
    expect(tidyText('   ')).toBe('');
  });

  it('leaves short text alone', () => {
    expect(clipText('Restocked.', 20)).toBe('Restocked.');
    expect(clipText('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });

  it('cuts at a word break, without trailing punctuation', () => {
    expect(clipText('Clean the filter, then refill it with water', 24)).toBe('Clean the filter, then…');
    expect(clipText('One two, three four five', 13)).toBe('One two…');
  });

  it('cuts a long word where it must', () => {
    const url = `https://example.com/${'a'.repeat(400)}`;
    const cut = clipText(url, 100);
    expect(Array.from(cut)).toHaveLength(100);
    expect(cut.endsWith('a…')).toBe(true);
  });

  it('does not break a word only a few characters in (no break in the last third)', () => {
    expect(clipText(`Hi ${'b'.repeat(50)}`, 20)).toBe(`Hi ${'b'.repeat(16)}…`);
  });

  it('never splits an emoji', () => {
    const family = '👨‍👩‍👧';
    const text = `${'a'.repeat(9)}${family}${family}b`;
    expect(clipText(text, 11)).toBe(`${'a'.repeat(9)}${family}…`);
  });
});

describe('links', () => {
  it('linkUrl builds ?item= and ?area= links', () => {
    expect(linkUrl(BASE, { kind: 'item', id: 'i1' })).toBe('https://home.example/?item=i1');
    expect(linkUrl(BASE, { kind: 'area', id: 'a1' })).toBe('https://home.example/?area=a1');
  });

  it('parseSharedLink reads them back', () => {
    expect(parseSharedLink('?item=i1')).toEqual({ kind: 'item', id: 'i1' });
    expect(parseSharedLink('?frame&area=a%201')).toEqual({ kind: 'area', id: 'a 1' });
    expect(parseSharedLink('?area=a1&item=i1')).toEqual({ kind: 'item', id: 'i1' });
    expect(parseSharedLink('?item=%20i1%20')).toEqual({ kind: 'item', id: 'i1' });
  });

  it('parseSharedLink ignores what is not a link', () => {
    expect(parseSharedLink('')).toBeNull();
    expect(parseSharedLink('?invite=abc')).toBeNull();
    expect(parseSharedLink('?item=')).toBeNull();
    expect(parseSharedLink('?item=%20')).toBeNull();
    expect(parseSharedLink(`?item=${'x'.repeat(65)}`)).toBeNull();
    // An empty item falls through to the area.
    expect(parseSharedLink('?item=&area=a1')).toEqual({ kind: 'area', id: 'a1' });
  });

  it('round trip', () => {
    const link = { kind: 'item' as const, id: '7f1c2d3e-0000-4000-8000-000000000001' };
    expect(parseSharedLink(new URL(linkUrl(BASE, link)).search)).toEqual(link);
  });
});
