import { DemoBackend, DEMO_STORAGE_KEY } from '../backend/demo';
import { SAVED_HOME_DOC } from './savedHome';

class Mem {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('the saved home', () => {
  it('is a valid phone document with the home from the screenshot', async () => {
    const storage = new Mem();
    storage.setItem(DEMO_STORAGE_KEY, SAVED_HOME_DOC);
    const b = new DemoBackend({ storage, search: '', latency: 0, user: { id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' } });
    const hid = (await b.getMyHouseholdId())!;
    const data = await b.load(hid);
    expect(data.areas.map((a) => a.name)).toEqual([
      'Kitchen',
      'Living Room',
      'Bathroom Small',
      'Bathroom Large',
      'Bedroom Small',
      'Bedroom Large',
      'Garden',
      'Garden Lounge',
      'Jacuzzi',
      'Hallway',
      'Front garden',
    ]);
    expect(data.items).toHaveLength(21);
    expect(data.members.map((m) => [m.name, m.emoji, m.user_id === null])).toEqual([
      ['Stratis', '🦆', false],
      ['Shea', '🦔', true],
    ]);
    const byTitle = (t: string) => data.items.filter((it) => it.title === t);
    expect(byTitle('Tidiness')).toHaveLength(5);
    expect(byTitle('Check Chemicals')[0]).toMatchObject({ kind: 'task', rag: 'green', due_date: '2026-10-20', note: 'Order a new pack.' });
    expect(byTitle('Change the filter')[0]).toMatchObject({ repeat: 'monthly', due_date: '2026-10-21' });
    expect(data.completions).toHaveLength(0);
    expect(data.housekeeping.visits).toHaveLength(0);
  });
});
