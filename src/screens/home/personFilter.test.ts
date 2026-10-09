import { countsFor, isFor, personFilterKey, validFilter } from './personFilter';

const members = [{ id: 'm1' }, { id: 'm2' }];
const items = [{ assignee_id: 'm1' }, { assignee_id: 'm1' }, { assignee_id: 'm2' }, { assignee_id: null }];

describe('person filter', () => {
  it('matches everyone, one person, or the unassigned', () => {
    expect(items.filter((it) => isFor(it, 'all'))).toHaveLength(4);
    expect(items.filter((it) => isFor(it, 'm1'))).toHaveLength(2);
    expect(items.filter((it) => isFor(it, 'none'))).toHaveLength(1);
  });

  it('counts open items per chip', () => {
    expect(countsFor(items, members)).toEqual({ all: 4, none: 1, m1: 2, m2: 1 });
    expect(countsFor([], members)).toEqual({ all: 0, none: 0, m1: 0, m2: 0 });
  });

  it('reads a remembered choice back, falling back to everyone for someone who left', () => {
    expect(validFilter('m2', members)).toBe('m2');
    expect(validFilter('gone', members)).toBe('all');
    expect(validFilter(null, members)).toBe('all');
    expect(validFilter('none', members)).toBe('none');
    expect(personFilterKey('h1')).toBe('homeos.who.h1');
  });
});
