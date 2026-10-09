import { describe, expect, it } from 'vitest';
import { buildDigest, dueLabel, escapeHtml, NOTHING_OPEN, renderWeeklyEmail, type WeeklyEmailInput } from './email.ts';
import { area, completion, household, item, member } from './test-fixtures.ts';

const APP = 'https://home.example.com/';
// Monday 12 Oct 2026, 08:00 BST.
const NOW = new Date('2026-10-12T07:00:00Z');
const TODAY = '2026-10-12';

function fixture() {
  const h = household();
  const stratis = member(h, { name: 'Stratis', emoji: '🦔', role: 'owner', created_at: '2026-01-01T00:00:00Z' });
  const shea = member(h, { name: 'Shea', emoji: '🦆', created_at: '2026-01-02T00:00:00Z' });
  const ela = member(h, { name: 'Ela', emoji: '🦊', created_at: '2026-01-03T00:00:00Z' });
  const kitchen = area(h, 'Kitchen', 0);
  const garden = area(h, 'Garden', 2);
  const hallway = area(h, 'Hallway', 1);

  const items = [
    item(hallway, { title: 'Heaters not working', note: 'No heat since the weekend.', rag: 'red', due_date: '2026-10-10', assignee_id: shea.id }),
    item(kitchen, { title: 'Descale kettle', rag: 'amber', due_date: '2026-10-11', assignee_id: null }),
    item(kitchen, { title: 'Water strips', rag: 'amber', due_date: TODAY, assignee_id: null }),
    item(garden, { title: 'Firepit', rag: 'green', due_date: '2026-10-13', assignee_id: ela.id }),
    item(garden, { title: 'Week out', rag: 'green', due_date: '2026-10-19', assignee_id: ela.id }),
    item(garden, { title: 'Clean cushions', rag: 'green', due_date: '2026-10-20', assignee_id: ela.id }),
    item(kitchen, { title: 'Olive oil', note: 'Restocked, 5L tin is in the pantry.', rag: 'green', due_date: '2026-11-12', assignee_id: stratis.id }),
    item(hallway, { title: 'Paint skirting', rag: 'amber', due_date: null, assignee_id: null }),
  ];
  const completions = [
    completion(h, { item_title: 'Kitchen paper', credited_to: stratis.id, completed_at: '2026-10-06T09:00:00Z' }),
    completion(h, { item_title: 'Kitchen paper', credited_to: stratis.id, completed_at: '2026-10-11T09:00:00Z' }),
    // PostgREST returns microseconds and an offset.
    completion(h, { item_title: 'Mow lawn', credited_to: shea.id, completed_at: '2026-10-08T09:00:00.123456+00:00' }),
    completion(h, { item_title: 'Bins', credited_to: ela.id, completed_at: '2026-10-09T09:00:00Z' }),
    completion(h, { item_title: 'Fix gate', credited_to: ela.id, completed_at: '2026-10-10T09:00:00Z' }),
    completion(h, { item_title: 'Fix gate', credited_to: ela.id, completed_at: '2026-10-11T09:00:00Z' }),
    // Older than a week: not counted.
    completion(h, { item_title: 'Old job', credited_to: shea.id, completed_at: '2026-10-05T06:59:00Z' }),
    // Credited to someone who has left.
    completion(h, { item_title: 'Gutters', credited_to: null, completed_at: '2026-10-07T09:00:00Z' }),
  ];
  const input: WeeklyEmailInput = {
    household: h,
    members: [stratis, shea, ela],
    areas: [kitchen, garden, hallway],
    items,
    completions,
    today: TODAY,
    now: NOW,
    appUrl: APP,
  };
  return { input, h, stratis, shea, ela };
}

/** Fails unless every needle appears in `haystack`, each after the one before. */
function expectInOrder(haystack: string, needles: string[]) {
  let from = 0;
  for (const n of needles) {
    const i = haystack.indexOf(n, from);
    expect(i, `"${n}" missing or out of order`).toBeGreaterThanOrEqual(0);
    from = i + n.length;
  }
}

describe('dueLabel', () => {
  it('reads like the app', () => {
    expect(dueLabel(null, TODAY)).toBeNull();
    expect(dueLabel('2026-10-11', TODAY)).toEqual({ text: 'Sun 11 Oct · 1 day late', missed: true });
    expect(dueLabel('2026-10-09', TODAY)).toEqual({ text: 'Fri 9 Oct · 3 days late', missed: true });
    expect(dueLabel(TODAY, TODAY)).toEqual({ text: 'Today', missed: false });
    expect(dueLabel('2026-10-13', TODAY)).toEqual({ text: 'Tomorrow', missed: false });
    expect(dueLabel('2026-10-20', TODAY)).toEqual({ text: 'Tue 20 Oct', missed: false });
    expect(dueLabel('2027-01-05', TODAY)).toEqual({ text: 'Tue 5 Jan 2027', missed: false });
  });
});

describe('buildDigest', () => {
  it('sorts items into the README sections', () => {
    const { input } = fixture();
    const d = buildDigest(input);
    expect(d.place).toBe('21 Alderbrook Road');
    expect(d.missed.map((r) => r.title)).toEqual(['Heaters not working', 'Descale kettle']);
    expect(d.missed[0]).toMatchObject({ area: 'Hallway', who: '🦆 Shea', due: { text: 'Sat 10 Oct · 2 days late', missed: true } });
    // Today through today + 7.
    expect(d.dueSoon.map((r) => r.title)).toEqual(['Water strips', 'Firepit', 'Week out']);
    // Everything else, by area position (Kitchen 0, Hallway 1, Garden 2).
    expect(d.others.map((g) => [g.area, g.rows.map((r) => r.title)])).toEqual([
      ['Kitchen', ['Olive oil']],
      ['Hallway', ['Paint skirting']],
      ['Garden', ['Clean cushions']],
    ]);
    expect(d.unassigned.map((r) => r.title)).toEqual(['Descale kettle', 'Water strips', 'Paint skirting']);
    expect(d.nothingOpen).toBe(false);
  });

  it('counts what each person did in the last 7 days, most first', () => {
    const { input } = fixture();
    expect(buildDigest(input).done).toEqual([
      { who: '🦊 Ela', count: 3, titles: ['Bins', 'Fix gate ×2'] },
      { who: '🦔 Stratis', count: 2, titles: ['Kitchen paper ×2'] },
      { who: '🦆 Shea', count: 1, titles: ['Mow lawn'] },
      { who: 'Former member', count: 1, titles: ['Gutters'] },
    ]);
  });
});

describe('renderWeeklyEmail', () => {
  it('uses the address in the subject, else the household name', () => {
    const { input } = fixture();
    expect(renderWeeklyEmail(input).subject).toBe('home.os weekly: 21 Alderbrook Road');
    const named = { ...input, household: { ...input.household, address: '  ', name: 'The Flat' } };
    expect(renderWeeklyEmail(named).subject).toBe('home.os weekly: The Flat');
  });

  it('puts the sections in README order in the HTML', () => {
    const { input } = fixture();
    const { html } = renderWeeklyEmail(input);
    expectInOrder(html, [
      '>Missed</td>',
      'Heaters not working',
      '>Due in the next 7 days</td>',
      'Water strips',
      '>Everything else</td>',
      'Olive oil',
      '>Unassigned</td>',
      '>Done this week</td>',
      '🦊 Ela',
      'Open home.os</a>',
    ]);
    expect(html).toContain(`href="${APP}"`);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('shows area, assignee with emoji and days late for missed items, in red', () => {
    const { input } = fixture();
    const { html } = renderWeeklyEmail(input);
    const missed = html.slice(html.indexOf('>Missed</td>'), html.indexOf('>Due in the next 7 days</td>'));
    expect(missed).toContain('Hallway · 🦆 Shea · <span style="color:#D70015;font-weight:600;">Sat 10 Oct · 2 days late</span>');
    expect(missed).toContain('Kitchen · Unassigned · <span style="color:#D70015;font-weight:600;">Sun 11 Oct · 1 day late</span>');
    expect(missed).toContain('No heat since the weekend.');
  });

  it('draws RAG dots in the app colours and groups the rest by area', () => {
    const { input } = fixture();
    const { html } = renderWeeklyEmail(input);
    expect(html).toContain('background-color:#FF3B30'); // red
    expect(html).toContain('background-color:#FF9500'); // amber
    expect(html).toContain('background-color:#34C759'); // green
    const rest = html.slice(html.indexOf('>Everything else</td>'), html.indexOf('>Unassigned</td>'));
    expectInOrder(rest, ['>Kitchen</td>', 'Olive oil', '>Hallway</td>', 'Paint skirting', '>Garden</td>', 'Clean cushions']);
    expect(rest).toContain('🦔 Stratis · <span style="font-weight:600;">Thu 12 Nov</span>');
  });

  it('uses the app look: system font, grey page, white rounded cards', () => {
    const { html } = renderWeeklyEmail(fixture().input);
    expect(html).toContain("font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text'");
    expect(html).toContain('background-color:#F2F2F7');
    expect(html).toContain('background-color:#FFFFFF;border-radius:24px');
    expect(html).toContain('max-width:560px');
    expect(html).toContain('name="viewport"');
  });

  it('has a plain-text version with the same sections in order', () => {
    const { input } = fixture();
    const { text } = renderWeeklyEmail(input);
    expectInOrder(text, [
      'home.os weekly: 21 Alderbrook Road',
      'Week of Mon 12 Oct',
      'MISSED',
      '* [Red] Heaters not working',
      '  Hallway · 🦆 Shea · Sat 10 Oct · 2 days late',
      'DUE IN THE NEXT 7 DAYS',
      '  Kitchen · Unassigned · Today',
      'EVERYTHING ELSE',
      'Kitchen\n* [Green] Olive oil',
      'UNASSIGNED',
      'DONE THIS WEEK',
      '* 🦊 Ela: 3 (Bins, Fix gate ×2)',
      `Open home.os: ${APP}`,
    ]);
    expect(text).not.toContain('<');
  });

  it('leaves out empty sections', () => {
    const { input } = fixture();
    const onlyLater = { ...input, items: input.items.filter((i) => i.due_date === '2026-11-12'), completions: [] };
    const { html, text } = renderWeeklyEmail(onlyLater);
    for (const heading of ['>Missed</td>', '>Due in the next 7 days</td>', '>Unassigned</td>', '>Done this week</td>', '>Everything else</td>']) {
      expect(html).not.toContain(heading);
    }
    // With nothing above it, the area list is simply "everything open".
    expect(html).toContain('>Everything open</td>');
    expect(text).toContain('EVERYTHING OPEN');
    expect(html).not.toContain(NOTHING_OPEN);
  });

  it('says so when nothing is open, and still shows what got done', () => {
    const { input } = fixture();
    const { html, text } = renderWeeklyEmail({ ...input, items: [] });
    expect(html).toContain(NOTHING_OPEN);
    expect(text).toContain(NOTHING_OPEN);
    expect(html).toContain('>Done this week</td>');
    expect(html).not.toContain('>Missed</td>');
    expect(html).toContain('Open home.os</a>');

    const quiet = renderWeeklyEmail({ ...input, items: [], completions: [] });
    expect(quiet.html).toContain(NOTHING_OPEN);
    expect(quiet.html).not.toContain('>Done this week</td>');
  });

  it('escapes everything people typed', () => {
    const { input, shea } = fixture();
    const evil = {
      ...input,
      household: { ...input.household, address: 'Flat 2 & 3 <b>Road</b>' },
      members: input.members.map((m) => (m.id === shea.id ? { ...m, name: '<img src=x onerror=alert(1)>', emoji: '"><' } : m)),
      areas: input.areas.map((a) => ({ ...a, name: `${a.name} "quoted" <i>` })),
      items: [
        ...input.items,
        item(input.areas[0], { title: '<script>alert("x")</script>', note: "it's <b>bold</b>", due_date: '2026-10-11', assignee_id: shea.id }),
      ],
    };
    const { html, subject } = renderWeeklyEmail(evil);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('it&#39;s &lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('Flat 2 &amp; 3 &lt;b&gt;Road&lt;/b&gt;');
    expect(html).toContain('&quot;&gt;&lt; &lt;img src=x onerror=alert(1)&gt;');
    // The subject is plain text (not HTML), but it is escaped inside <title>.
    expect(subject).toBe('home.os weekly: Flat 2 & 3 <b>Road</b>');
    expect(html).toContain('<title>home.os weekly: Flat 2 &amp; 3 &lt;b&gt;Road&lt;/b&gt;</title>');
  });

  it('only links to http(s) app URLs', () => {
    const { input } = fixture();
    expect(renderWeeklyEmail({ ...input, appUrl: 'javascript:alert(1)' }).html).toContain('href="#"');
    expect(renderWeeklyEmail({ ...input, appUrl: 'https://x.example/?a=1&b="2"' }).html).toContain(
      'href="https://x.example/?a=1&amp;b=%222%22"',
    );
  });

  it('names the send day in the footer', () => {
    const { input } = fixture();
    expect(renderWeeklyEmail(input).text).toContain('You get this email every Monday.');
    const friday = { ...input, household: { ...input.household, weekly_email_day: 5 } };
    expect(renderWeeklyEmail(friday).html).toContain('You get this email every Friday.');
  });

  it('never uses an em dash', () => {
    const { html, text } = renderWeeklyEmail(fixture().input);
    expect(html).not.toContain('\u2014');
    expect(text).not.toContain('\u2014');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });
});

describe('states (To maintain)', () => {
  /** The fixture plus states: a Pizza oven (Garden, Ela), an unassigned Jacuzzi (Hallway), an Aga (Kitchen). */
  function withStates() {
    const f = fixture();
    const [kitchen, garden, hallway] = f.input.areas;
    const states = [
      item(garden, { kind: 'state', title: 'Pizza oven', note: 'Keep the cover on.', rag: 'green', assignee_id: f.ela.id }),
      // A stale row with a past due date is still never missed.
      item(hallway, { kind: 'state', title: 'Jacuzzi', rag: 'amber', due_date: '2026-10-01', assignee_id: null }),
      item(kitchen, { kind: 'state', title: 'Aga', rag: 'red', assignee_id: f.stratis.id }),
    ];
    return { ...f, input: { ...f.input, items: [...states, ...f.input.items] } };
  }

  it('are never missed or due: they go under their area, after its to-dos, by title', () => {
    const d = buildDigest(withStates().input);
    const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
    expect(titles(d.missed)).not.toContain('Jacuzzi');
    expect(titles(d.dueSoon)).not.toContain('Pizza oven');
    expect(d.others.map((g) => [g.area, titles(g.rows)])).toEqual([
      ['Kitchen', ['Olive oil', 'Aga']],
      ['Hallway', ['Paint skirting', 'Jacuzzi']],
      ['Garden', ['Clean cushions', 'Pizza oven']],
    ]);
    const oven = d.others[2].rows[1];
    expect(oven).toMatchObject({ maintain: true, due: null, who: '🦊 Ela', note: 'Keep the cover on.' });
    expect(d.others[0].rows[0].maintain).toBe(false);
  });

  it('are left out of the unassigned list, which is about to-dos', () => {
    const d = buildDigest(withStates().input);
    expect(d.unassigned.map((r) => r.title)).toEqual(['Descale kettle', 'Water strips', 'Paint skirting']);
  });

  it('carry a "To maintain" marker in the HTML and the plain text', () => {
    const { html, text } = renderWeeklyEmail(withStates().input);
    expectInOrder(html, ['Pizza oven', 'Keep the cover on.', '🦊 Ela', 'To maintain']);
    expectInOrder(text, ['Garden', '* [Green] Clean cushions', '* [Green] Pizza oven', '  Keep the cover on.', '  🦊 Ela · To maintain']);
    expect(text).toContain('* [Amber] Jacuzzi\n  Unassigned · To maintain');
    expect(text.match(/To maintain/g)).toHaveLength(3);
    // Never "late".
    expect(text).not.toMatch(/Jacuzzi[^\n]*\n[^\n]*late/);
  });

  it('count as open: only states open is not "nothing open"', () => {
    const f = fixture();
    const garden = f.input.areas[1];
    const input = { ...f.input, items: [item(garden, { kind: 'state', title: 'Firepit', rag: 'green' })] };
    const d = buildDigest(input);
    expect(d.nothingOpen).toBe(false);
    expect(d.others).toEqual([{ area: 'Garden', rows: [expect.objectContaining({ title: 'Firepit', maintain: true })] }]);
    const { text } = renderWeeklyEmail(input);
    expect(text).toContain('EVERYTHING OPEN');
    expect(text).not.toContain(NOTHING_OPEN);
  });
});
