import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatReaction, Member } from '../types';
import {
  applyReaction,
  buildRows,
  compareMessages,
  dayLabel,
  formatClock,
  hasUnread,
  joinNames,
  keyboardInset,
  mergeMessages,
  mergeNewestPage,
  newestTimestamp,
  reactionChipLabel,
  senderOf,
  stampLabel,
  summarizeReactions,
  type ChatEntry,
} from './chat';

const TZ = 'Europe/London';
/** Thu 8 Oct 2026, 10:00 in London (BST, UTC+1). */
const NOW = new Date('2026-10-08T09:00:00Z');

function msg(id: string, created_at: string, member_id: string | null = 'shea', over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, household_id: 'h1', member_id, body: `Message ${id}`, created_at, reactions: [], ...over };
}

function member(id: string, name: string, emoji: string): Member {
  return {
    id,
    household_id: 'h1',
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const MEMBERS = [member('me', 'Stratis', '🦔'), member('shea', 'Shea', '🦆'), member('ela', 'Ela', '🦊')];

const entry = (m: ChatMessage, state: ChatEntry['state'] = 'sent'): ChatEntry => ({ key: m.id, message: m, state });

function reaction(member_id: string, emoji: string, created_at = '2026-10-08T08:00:00Z', message_id = 'm1'): ChatReaction {
  return { message_id, member_id, emoji, created_at };
}

describe('ordering and merging', () => {
  it('orders by instant whatever the ISO form, then by id', () => {
    const a = msg('a', '2026-10-08T08:00:00+00:00');
    const b = msg('b', '2026-10-08T08:00:00.000Z');
    const c = msg('c', '2026-10-08T07:59:59Z');
    expect([a, b, c].sort(compareMessages).map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('merges by id: incoming replaces, unless the held copy is newer', () => {
    const held = [msg('a', '2026-10-08T08:00:00Z'), msg('b', '2026-10-08T08:01:00Z', 'shea', { body: 'held' })];
    const incoming = [msg('b', '2026-10-08T08:01:00Z', 'shea', { body: 'fresh' }), msg('c', '2026-10-08T07:00:00Z')];
    expect(mergeMessages(held, incoming).map((m) => `${m.id}:${m.body}`)).toEqual([
      'c:Message c',
      'a:Message a',
      'b:fresh',
    ]);
    expect(mergeMessages(held, incoming, (id) => id === 'b').find((m) => m.id === 'b')!.body).toBe('held');
    expect(mergeMessages(held, [])).toBe(held);
  });

  describe('mergeNewestPage', () => {
    const t = (min: number) => new Date(Date.UTC(2026, 9, 8, 8, min)).toISOString();

    it('takes the page as the truth in its window (deleted ones go), keeps older loaded ones', () => {
      const current = [msg('old', t(0)), msg('a', t(10)), msg('gone', t(11)), msg('b', t(12))];
      const page = { messages: [msg('a', t(10), 'shea', { body: 'edited reactions' }), msg('b', t(12)), msg('c', t(13))], hasMore: true };
      const { messages, hasMore } = mergeNewestPage(current, false, page);
      expect(messages.map((m) => m.id)).toEqual(['old', 'a', 'b', 'c']);
      expect(messages[1].body).toBe('edited reactions');
      expect(hasMore).toBe(false); // the older loaded part reached the start
    });

    it('starts paging again when what is loaded may not join up with the page', () => {
      const current = [msg('x', t(0)), msg('y', t(1))];
      const page = { messages: [msg('p', t(30)), msg('q', t(31))], hasMore: true };
      expect(mergeNewestPage(current, false, page)).toEqual({ messages: page.messages, hasMore: true });
    });

    it('keeps messages that arrived here after the page was asked for', () => {
      const current = [msg('a', t(10)), msg('late', t(20)), msg('stale', t(21))];
      const page = { messages: [msg('a', t(10))], hasMore: false };
      const keep = (id: string) => id === 'late';
      expect(mergeNewestPage(current, false, page, keep).messages.map((m) => m.id)).toEqual(['a', 'late']);
    });

    it('prefers the held copy of a message changed here after the request', () => {
      const current = [msg('a', t(10), 'shea', { body: 'local' })];
      const page = { messages: [msg('a', t(10), 'shea', { body: 'server, older' })], hasMore: false };
      expect(mergeNewestPage(current, false, page, () => true).messages[0].body).toBe('local');
    });

    it('an empty page empties the chat (everything was deleted)', () => {
      expect(mergeNewestPage([msg('a', t(1))], true, { messages: [], hasMore: false })).toEqual({ messages: [], hasMore: false });
    });
  });
});

describe('times in the household time zone', () => {
  it('formats the clock as 24-hour local time', () => {
    expect(formatClock('2026-10-08T07:05:00Z', TZ)).toBe('08:05');
    expect(formatClock('2026-10-07T17:42:00Z', TZ)).toBe('18:42');
    expect(formatClock('2026-10-07T17:42:00Z', 'Asia/Tokyo')).toBe('02:42');
  });

  it('says Today, Yesterday, or the date (with the year when it is another year)', () => {
    expect(dayLabel('2026-10-08T06:00:00Z', TZ, NOW)).toBe('Today');
    expect(dayLabel('2026-10-07T12:00:00Z', TZ, NOW)).toBe('Yesterday');
  });

  it('uses the local day, not the UTC one', () => {
    // 23:30 UTC on the 7th is 00:30 on the 8th in London.
    expect(dayLabel('2026-10-07T23:30:00Z', TZ, NOW)).toBe('Today');
    expect(dayLabel('2026-10-07T22:59:00Z', TZ, NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-06T12:00:00Z', TZ, NOW)).toBe('Tue 6 Oct');
    expect(dayLabel('2025-12-24T12:00:00Z', TZ, NOW)).toBe('Wed 24 Dec 2025');
    expect(stampLabel('2026-10-07T17:42:00Z', TZ, NOW)).toEqual({ day: 'Yesterday', time: '18:42' });
  });
});

describe('buildRows', () => {
  it('puts a separator at each new day and after an hour, and groups runs within 5 minutes', () => {
    const entries = [
      msg('1', '2026-10-07T17:42:00Z', 'shea'),
      msg('2', '2026-10-07T17:51:00Z', 'me'),
      msg('3', '2026-10-07T17:53:00Z', 'me'),
      msg('4', '2026-10-07T17:59:00Z', 'me'), // 6 minutes later: a new run
      msg('5', '2026-10-07T20:15:00Z', 'ela'), // over an hour: separator
      msg('6', '2026-10-08T07:05:00Z', 'ela'), // next day: separator, new run
      msg('7', '2026-10-08T07:06:00Z', null), // a former member: a run of their own
    ].map((m) => entry(m));
    const rows = buildRows(entries, 'me', TZ, NOW);
    expect(
      rows.map((r) =>
        r.kind === 'separator' ? `[${r.day} ${r.time}]` : `${r.key}${r.mine ? ' mine' : ''}${r.first ? ' first' : ''}${r.last ? ' last' : ''}`,
      ),
    ).toEqual([
      '[Yesterday 18:42]',
      '1 first last',
      '2 mine first',
      '3 mine last',
      '4 mine first last',
      '[Yesterday 21:15]',
      '5 first last',
      '[Today 08:05]',
      '6 first last',
      '7 first last',
    ]);
  });

  it('is empty for no messages, and keeps the entry keys', () => {
    expect(buildRows([], 'me', TZ, NOW)).toEqual([]);
    const pending: ChatEntry = { key: 'local-1', message: msg('local-1', '2026-10-08T08:00:00Z', 'me'), state: 'sending' };
    const rows = buildRows([pending], 'me', TZ, NOW);
    expect(rows[1]).toMatchObject({ kind: 'message', key: 'local-1', mine: true, first: true, last: true });
  });
});

describe('people', () => {
  it('names the sender, or a former member', () => {
    expect(senderOf('shea', MEMBERS)).toEqual({ name: 'Shea', emoji: '🦆', known: true });
    expect(senderOf(null, MEMBERS)).toMatchObject({ name: 'Former member', known: false });
    expect(senderOf('someone-gone', MEMBERS)).toMatchObject({ name: 'Former member', known: false });
  });

  it('joins names the English way', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Shea'])).toBe('Shea');
    expect(joinNames(['Shea', 'you'])).toBe('Shea and you');
    expect(joinNames(['Shea', 'Ela', 'you'])).toBe('Shea, Ela and you');
  });
});

describe('reactions', () => {
  it('makes one chip per emoji in first-use order, with who and whether you reacted', () => {
    const chips = summarizeReactions(
      [reaction('shea', '👍'), reaction('ela', '❤️'), reaction('me', '👍'), reaction('me', '👍')],
      'me',
    );
    expect(chips).toEqual([
      { emoji: '👍', count: 2, mine: true, memberIds: ['shea', 'me'] },
      { emoji: '❤️', count: 1, mine: false, memberIds: ['ela'] },
    ]);
    expect(reactionChipLabel(chips[0], MEMBERS, 'me')).toBe('👍, 2 reactions from Shea and you');
    expect(reactionChipLabel(chips[1], MEMBERS, 'me')).toBe('❤️, 1 reaction from Ela');
    const gone = summarizeReactions([reaction('left', '🙏')], 'me')[0];
    expect(reactionChipLabel(gone, MEMBERS, 'me')).toBe('🙏, 1 reaction from Former member');
  });

  it('adds or removes only your reaction, and leaves the message alone when nothing changes', () => {
    const m = msg('m1', '2026-10-08T07:00:00Z', 'shea', { reactions: [reaction('shea', '👍')] });
    const on = applyReaction(m, 'me', '👍', true, '2026-10-08T08:30:00Z');
    expect(on.reactions).toEqual([reaction('shea', '👍'), reaction('me', '👍', '2026-10-08T08:30:00Z')]);
    expect(applyReaction(on, 'me', '👍', true, 'x')).toBe(on);
    expect(applyReaction(on, 'me', '👍', false, 'x').reactions).toEqual([reaction('shea', '👍')]);
    expect(applyReaction(m, 'me', '❤️', false, 'x')).toBe(m);
  });
});

describe('unread', () => {
  const messages = [msg('a', '2026-10-08T07:00:00Z', 'shea'), msg('b', '2026-10-08T07:10:00Z', 'me')];

  it('is unread when someone else wrote after the last read time', () => {
    expect(hasUnread(messages, 'me', null)).toBe(true);
    expect(hasUnread(messages, 'me', '2026-10-08T06:59:59Z')).toBe(true);
    expect(hasUnread(messages, 'me', '2026-10-08T07:00:00+00:00')).toBe(false);
    // Your own newer message never counts.
    expect(hasUnread([msg('b', '2026-10-08T07:10:00Z', 'me')], 'me', null)).toBe(false);
    // A former member's message does.
    expect(hasUnread([msg('c', '2026-10-08T07:20:00Z', null)], 'me', '2026-10-08T07:10:00Z')).toBe(true);
    expect(hasUnread([], 'me', null)).toBe(false);
  });

  it('finds the newest time', () => {
    expect(newestTimestamp([])).toBeNull();
    expect(newestTimestamp([messages[1], messages[0]])).toBe('2026-10-08T07:10:00Z');
  });
});

describe('keyboardInset', () => {
  it('is the part of the page below the visual viewport (the keyboard)', () => {
    expect(keyboardInset(874, { height: 874, offsetTop: 0 })).toBe(0);
    // iOS: the keyboard shrinks the visual viewport...
    expect(keyboardInset(874, { height: 538.4, offsetTop: 0 })).toBe(336);
    // ...and may scroll it; what is below it is still the keyboard.
    expect(keyboardInset(874, { height: 538, offsetTop: 120 })).toBe(216);
    expect(keyboardInset(874, { height: 538, offsetTop: 336 })).toBe(0);
  });

  it('ignores small wobbles and a missing visualViewport', () => {
    expect(keyboardInset(874, { height: 850, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(874, null)).toBe(0);
    expect(keyboardInset(874, undefined)).toBe(0);
  });
});
