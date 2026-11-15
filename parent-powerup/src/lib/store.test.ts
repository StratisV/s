import { actions, emptyState, getState, resetStore, sanitize } from './store';

const kid = {
  name: 'Mia',
  birth: '2022-08',
  avatar: '🦊',
  colour: 'coral' as const,
  temperament: [],
  interests: [],
  focus: [],
  notes: '',
};

beforeEach(() => resetStore());

describe('store', () => {
  it('adds, edits and removes kids', () => {
    const mia = actions.addKid(kid);
    expect(getState().kids).toHaveLength(1);
    actions.updateKid(mia.id, { name: 'Mia Rose' });
    expect(getState().kids[0].name).toBe('Mia Rose');
    actions.logSession({ date: '2026-11-15', meditationId: 'x', mode: 'together', kidIds: [mia.id] });
    actions.removeKid(mia.id);
    expect(getState().kids).toHaveLength(0);
    expect(getState().sessions[0].kidIds).toEqual([]);
  });

  it('bookmarks and un-bookmarks a Powerup', () => {
    actions.toggleSaved('a');
    expect(getState().saved).toEqual(['a']);
    actions.toggleSaved('a');
    expect(getState().saved).toEqual([]);
  });

  it('rates the last session', () => {
    actions.logSession({ date: '2026-11-15', meditationId: 'x', mode: 'solo', kidIds: [] });
    actions.rateLastSession(3);
    expect(getState().sessions[0].feeling).toBe(3);
  });
});

describe('sanitize', () => {
  it('falls back to empty for anything malformed', () => {
    expect(sanitize(null)).toEqual(emptyState());
    expect(sanitize('x')).toEqual(emptyState());
    expect(sanitize({ kids: [{ name: 'No id' }, { id: '1', name: 'Ok', birth: '2020-01' }], sessions: [{}] })).toMatchObject({
      kids: [{ id: '1', name: 'Ok', birth: '2020-01', avatar: '🌟', colour: 'sun' }],
      sessions: [],
    });
  });

  it('drops a birth month in the wrong shape', () => {
    expect(sanitize({ kids: [{ id: '1', name: 'A', birth: '2020' }] }).kids).toEqual([]);
  });
});
