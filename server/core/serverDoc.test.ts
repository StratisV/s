import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../../src/lib/backend/demo';
import { homeBlobPath, newServerDoc, parseServerDoc, serialiseServerDoc, usageMonth } from './serverDoc';

const NOW = new Date('2026-10-09T11:00:00.000Z');

describe('the stored document', () => {
  it('starts at rev 1 with the home at rest and no sign-in data', () => {
    const home = { ...emptyDoc(), session: 'someone', users: [{ id: 'someone', email: '', name: 'X' }] };
    const doc = newServerDoc(home, NOW);
    expect(doc).toMatchObject({ format: 'homeos.server/1', rev: 1, auth: { devices: [], codes: [] } });
    expect(doc).not.toHaveProperty('chatRev');
    expect(doc.home.session).toBeNull();
    expect(doc.home.users).toEqual([]);
    expect(doc.meta).toEqual({ createdAt: NOW.toISOString(), writes: [], usage: { month: '2026-10', puts: 0, reads: 0 } });
  });

  it('reads back what it stores, and refuses anything else', () => {
    const doc = newServerDoc(emptyDoc(), NOW);
    expect(parseServerDoc(serialiseServerDoc(doc))).toEqual(doc);
    expect(() => parseServerDoc('not json')).toThrow();
    expect(() => parseServerDoc(JSON.stringify({ ...doc, format: 'other' }))).toThrow();
    expect(() => parseServerDoc(JSON.stringify({ ...doc, rev: 0 }))).toThrow();
    expect(() => parseServerDoc(JSON.stringify({ ...doc, auth: { devices: [] } }))).toThrow();
    expect(() => parseServerDoc(JSON.stringify({ ...doc, home: { ...doc.home, items: null } }))).toThrow();
    expect(() => parseServerDoc(JSON.stringify({ ...doc, meta: { ...doc.meta, usage: { month: '2026-10', puts: -1, reads: 0 } } }))).toThrow();
  });

  it('reads a home stored before sections (the live home’s shape), and refuses sections that are not a list', () => {
    const doc = newServerDoc(emptyDoc(), NOW);
    const { housekeeping_sections: _none, ...before } = doc.home;
    const old = { ...doc, home: before };
    expect(parseServerDoc(JSON.stringify(old)).home).toEqual(before);
    expect(() => parseServerDoc(JSON.stringify({ ...doc, home: { ...doc.home, housekeeping_sections: {} } }))).toThrow();
  });

  it('reads a document from when there was a chat as it is: its chatRev and the home’s messages stay', () => {
    const doc = newServerDoc(emptyDoc(), NOW);
    const message = { id: 'm', household_id: 'h', member_id: null, body: 'Hi', created_at: NOW.toISOString() };
    const reaction = { message_id: 'm', member_id: 'p', household_id: 'h', emoji: '👍', created_at: NOW.toISOString() };
    const old = { ...doc, chatRev: 4, home: { ...doc.home, messages: [message], message_reactions: [reaction] } };
    const body = JSON.stringify(old);
    const parsed = parseServerDoc(body);
    expect(parsed).toEqual(old);
    expect(serialiseServerDoc(parsed)).toBe(body);
  });

  it('keeps each Vercel environment in its own blob', () => {
    expect(homeBlobPath({ VERCEL_ENV: 'production' })).toBe('homeos/production/home.json');
    expect(homeBlobPath({ VERCEL_ENV: 'preview' })).toBe('homeos/preview/home.json');
    expect(homeBlobPath({})).toBe('homeos/development/home.json');
    expect(homeBlobPath({ VERCEL_ENV: 'production', HOMEOS_BLOB_PATH: 'x/y.json' })).toBe('x/y.json');
    expect(usageMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});
