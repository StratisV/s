// HomeProvider in server mode (docs/ARCHITECTURE.md "Server mode (no setup)", "HomeProvider in
// server mode"): the real provider on a real ServerBackend, talking to the real server handler
// in-process (server/testing/harness.ts), one "phone" per ServerBackend.

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, IPHONE_SAFARI, TEST_SETUP_CODE, type Harness } from '../../server/testing/harness';
import { DemoBackend, type StorageLike } from '../lib/backend/demo';
import { ServerBackend } from '../lib/backend/server';
import { BackendError, type Backend } from '../lib/backend/types';
import { DEMO_DOC_KEY } from '../lib/logic/importHome';
import { USER_DEMO_DOC } from '../lib/logic/importHome.fixture';
import { captureServerLinks, pendingSetupCode } from '../lib/serverLinks';
import { ChatProvider, useChat, type ChatContextValue } from './ChatProvider';
import { HomeProvider, useHome, type HomeContextValue } from './HomeProvider';

const PHONE = JSON.stringify(USER_DEMO_DOC);

function Expose({ onHome }: { onHome(home: HomeContextValue): void }) {
  onHome(useHome());
  return null;
}

function mount(backend: Backend) {
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <Expose onHome={(h) => (home = h)} />
    </HomeProvider>,
  );
  return () => home;
}

function phone(h: Harness) {
  const browser = h.browser();
  return { browser, backend: new ServerBackend({ fetch: browser.fetch, appUrl: 'https://home-os.example/' }) };
}

/** Opens the app at `url` (server mode captures ?setup= and ?code= at start-up). */
function openAt(url: string) {
  window.history.replaceState(null, '', url);
  captureServerLinks();
}

/** The home online already (Stratis on another phone), with a code for Shea. */
async function homeElsewhere(h: Harness) {
  const other = phone(h);
  const entry = (await other.backend.bringOnline(TEST_SETUP_CODE, PHONE)) as { householdId: string };
  const data = await other.backend.load(entry.householdId);
  const shea = data.members.find((m) => m.name === 'Shea')!;
  return { other, hid: entry.householdId, sheaId: shea.id, sheaCode: (await other.backend.createCode(shea.id)).code };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Welcome screen in server mode', () => {
  it('offers to bring this phone’s home online when none is, with what comes along', async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    const h = createHarness();
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome?.kind).toBe('setup'));
    expect(home().phase.kind).toBe('signedOut');
    expect(home().serverWelcome).toEqual({
      kind: 'setup',
      setupCode: '',
      summary: expect.objectContaining({ householdName: 'Our home', areas: 6, items: 19, done: 3, messages: 0, visits: 0 }),
    });
  });

  it('fills in the setup code from a ?setup= link', async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    openAt('/?setup=test-setu-pcde');
    const home = mount(phone(createHarness()).backend);
    await waitFor(() => expect(home().serverWelcome).toMatchObject({ kind: 'setup', setupCode: 'TEST-SETU-PCDE' }));
  });

  it("says home.os isn't set up here yet to a phone with no home to bring", async () => {
    const home = mount(phone(createHarness()).backend);
    await waitFor(() => expect(home().serverWelcome).toEqual({ kind: 'private', homeOnline: false, code: '', notice: null }));
  });

  it('says where to use a setup link opened where the home is not (no demo home here)', async () => {
    openAt('/?setup=test-setu-pcde');
    const home = mount(phone(createHarness()).backend);
    await waitFor(() =>
      expect(home().serverWelcome).toMatchObject({ kind: 'setupElsewhere', setupCode: 'TEST-SETU-PCDE', summary: null, ios: false }),
    );
    // The household's saved copy (lib/logic/savedHome.ts) can come online from here.
    expect(home().serverWelcome).toMatchObject({ saved: { householdName: 'Our home', areas: 11, items: 21, done: 0 } });
  });

  it('brings the saved copy online from a browser without the home', async () => {
    openAt('/?setup=test-setu-pcde');
    const h = createHarness();
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome?.kind).toBe('setupElsewhere'));
    act(() => home().chooseSavedCopy());
    expect(home().serverWelcome).toMatchObject({ kind: 'setup', setupCode: 'TEST-SETU-PCDE', saved: true, summary: { areas: 11, items: 21 } });
    await act(async () => {
      await home().bringHomeOnline('TEST-SETU-PCDE');
    });
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().me).toMatchObject({ name: 'Stratis', role: 'owner' });
    expect(home().data!.areas.map((a) => a.name)).toEqual([
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
    expect(home().data!.items).toHaveLength(21);
    expect(home().data!.members.map((m) => [m.name, m.emoji, m.user_id !== null])).toEqual([
      ['Stratis', '🦆', true],
      ['Shea', '🦔', false],
    ]);
    // Nothing was kept in this browser.
    expect(localStorage.getItem(DEMO_DOC_KEY)).toBeNull();
  });

  it("can bring the saved copy online instead of this browser's", async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    const home = mount(phone(createHarness()).backend);
    await waitFor(() => expect(home().serverWelcome).toMatchObject({ kind: 'setup', summary: { areas: 6, items: 19 } }));
    act(() => home().chooseSavedCopy());
    expect(home().serverWelcome).toMatchObject({ kind: 'setup', saved: true, summary: { areas: 11, items: 21 } });
    await act(async () => {
      await home().bringHomeOnline(TEST_SETUP_CODE);
    });
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().data!.items).toHaveLength(21);
    expect(localStorage.getItem(DEMO_DOC_KEY)).toBe(PHONE);
  });

  it('in Safari on an iPhone, points a setup link at the Home Screen app, and can bring this copy online instead', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI);
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    openAt('/?setup=test-setu-pcde');
    const home = mount(phone(createHarness()).backend);
    await waitFor(() => expect(home().serverWelcome).toMatchObject({ kind: 'setupElsewhere', setupCode: 'TEST-SETU-PCDE', ios: true }));
    expect(home().serverWelcome).toMatchObject({ summary: expect.objectContaining({ householdName: 'Our home' }) });
    act(() => home().chooseSetupHere());
    expect(home().serverWelcome).toMatchObject({ kind: 'setup', setupCode: 'TEST-SETU-PCDE', elsewhere: true });
  });

  it('shows a stranger that the home is private, and a used setup link that it is too late', async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    const h = createHarness();
    await homeElsewhere(h);
    openAt('/?setup=TEST-SETU-PCDE');
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome).toEqual({ kind: 'private', homeOnline: true, code: '', notice: 'setupUsed' }));
    expect(pendingSetupCode()).toBeNull();
  });
});

describe('bringing the home online', () => {
  it('signs this phone in as the owner and opens the home with "haven\'t joined yet"', async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    const h = createHarness();
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome?.kind).toBe('setup'));
    await act(async () => {
      await expect(home().bringHomeOnline('WRON-GCOD-EXXX')).rejects.toMatchObject({ code: 'invalid_code' });
    });
    expect(home().serverWelcome?.kind).toBe('setup');
    await act(async () => {
      await home().bringHomeOnline('test setu pcde');
    });
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().me).toMatchObject({ name: 'Stratis', role: 'owner' });
    expect(home().onboardingTail).toBe(true);
    expect(home().invitePeople).toBe(true);
    expect(home().claimed).toBe(false);
    expect(home().data!.members.map((m) => [m.name, m.user_id !== null])).toEqual([
      ['Stratis', true],
      ['Shea', false],
    ]);
    // The phone's demo home is left as it was.
    expect(localStorage.getItem(DEMO_DOC_KEY)).toBe(PHONE);
  });

  it('says so when someone brought a home online first', async () => {
    localStorage.setItem(DEMO_DOC_KEY, PHONE);
    const h = createHarness();
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome?.kind).toBe('setup'));
    await homeElsewhere(h);
    await act(async () => {
      await expect(home().bringHomeOnline(TEST_SETUP_CODE)).rejects.toMatchObject({ code: 'home_exists' });
    });
    expect(home().serverWelcome).toEqual({ kind: 'private', homeOnline: true, code: '', notice: 'setupUsed' });
    expect(home().phase.kind).toBe('signedOut');
  });
});

describe('signing in with a code', () => {
  it('welcomes Shea as herself after her code', async () => {
    const h = createHarness();
    const { sheaCode, sheaId } = await homeElsewhere(h);
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome).toMatchObject({ kind: 'private', homeOnline: true }));
    await act(async () => {
      await expect(home().redeemCode('AAAA-AAAA')).rejects.toMatchObject({ code: 'invalid_code' });
    });
    await act(async () => {
      await home().redeemCode(sheaCode.toLowerCase());
    });
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().me).toMatchObject({ id: sheaId, name: 'Shea' });
    expect(home().claimed).toBe(true);
    expect(home().onboardingTail).toBe(true);
    expect(home().data!.items.filter((i) => i.assignee_id === sheaId)).toHaveLength(5);
  });

  it('tries a ?code= link by itself', async () => {
    const h = createHarness();
    const { sheaCode } = await homeElsewhere(h);
    openAt(`/?code=${sheaCode}`);
    expect(window.location.search).toBe('');
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().me?.name).toBe('Shea');
    expect(home().claimed).toBe(true);
  });

  it('does not use up a ?code= link in Safari on an iPhone: it waits to be used here or typed in the Home Screen app', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI);
    const h = createHarness();
    const { sheaCode } = await homeElsewhere(h);
    openAt(`/?code=${sheaCode}`);
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome).toEqual({ kind: 'private', homeOnline: true, code: sheaCode, notice: 'codeHere' }));
    expect(home().phase.kind).toBe('signedOut');
    // Typed in the Home Screen app, it works.
    const app = phone(h);
    expect(await app.backend.redeemCode(sheaCode)).toMatchObject({ status: 'claimed' });
  });

  it('keeps a ?code= link that did not work in the field, and says why', async () => {
    const h = createHarness();
    await homeElsewhere(h);
    openAt('/?code=ZZZZ-ZZZZ');
    const home = mount(phone(h).backend);
    await waitFor(() => expect(home().serverWelcome).toEqual({ kind: 'private', homeOnline: true, code: 'ZZZZ-ZZZZ', notice: 'codeInvalid' }));
  });

  it('does not try a ?code= link on a phone that is signed in already', async () => {
    const h = createHarness();
    const { other, sheaCode } = await homeElsewhere(h);
    openAt(`/?code=${sheaCode}`);
    const home = mount(other.backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    await waitFor(() => expect(home().toast?.message).toBe('This phone is already signed in as Stratis.'));
    expect(home().me?.name).toBe('Stratis');
  });
});

describe('signed in', () => {
  it('makes codes, lists devices, and removing this one signs out', async () => {
    const h = createHarness();
    const { other, sheaId } = await homeElsewhere(h);
    const home = mount(other.backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    let issued!: Awaited<ReturnType<HomeContextValue['createCode']>>;
    await act(async () => {
      issued = await home().createCode(sheaId);
    });
    expect(issued.link).toBe(`https://home-os.example/?code=${issued.code}`);
    let devices!: Awaited<ReturnType<HomeContextValue['listDevices']>>;
    await act(async () => {
      devices = await home().listDevices();
    });
    expect(devices).toEqual([expect.objectContaining({ current: true, label: 'iPhone · Safari' })]);
    await act(async () => {
      await home().removeDevice(devices[0].id);
    });
    await waitFor(() => expect(home().phase.kind).toBe('signedOut'));
    await waitFor(() => expect(home().serverWelcome).toMatchObject({ kind: 'private', homeOnline: true }));
  });

  it("hears another person's change through polling", async () => {
    const h = createHarness();
    const { other, hid, sheaCode } = await homeElsewhere(h);
    const home = mount(other.backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    const shea = phone(h);
    await shea.backend.redeemCode(sheaCode);
    await shea.backend.createArea(hid, 'Garage');
    // The next poll (at once on reconnect, as when the app comes back) brings it.
    act(() => other.backend.reconnect());
    await waitFor(() => expect(home().data!.areas.map((a) => a.name)).toContain('Garage'));
  });

  it("hears another person's chat message and reaction through polling", async () => {
    const h = createHarness();
    const { other, hid, sheaCode } = await homeElsewhere(h);
    let chat: ChatContextValue | null = null;
    const ExposeChat = () => {
      chat = useChat();
      return null;
    };
    const Chat = () => (useHome().phase.kind === 'ready' ? <ChatProvider><ExposeChat /></ChatProvider> : null);
    render(
      <HomeProvider backend={other.backend}>
        <Chat />
      </HomeProvider>,
    );
    await waitFor(() => expect(chat?.status).toBe('ready'));
    const shea = phone(h);
    await shea.backend.redeemCode(sheaCode);
    const sent = await shea.backend.sendMessage(hid, 'Bins go out tonight');
    act(() => other.backend.reconnect());
    await waitFor(() => expect(chat!.entries.map((e) => e.message.body)).toEqual(['Bins go out tonight']));
    await shea.backend.setReaction(sent.id, '👍', true);
    act(() => other.backend.reconnect());
    await waitFor(() => expect(chat!.entries[0].message.reactions.map((r) => r.emoji)).toEqual(['👍']));
  });

  it('says when saving is paused until next month', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Setup, the phone's first use of its key (one put per device, ever) and Shea's code are
    // three puts; the fourth uses the month up.
    const h = createHarness({ env: { HOMEOS_BLOB_WRITES_PER_MONTH: '4' } });
    const { other } = await homeElsewhere(h);
    const home = mount(other.backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().readOnly).toBe(false);
    await act(async () => {
      await home().createArea('Garage');
    });
    await act(async () => {
      await expect(home().createArea('Shed')).rejects.toMatchObject({ code: 'read_only' });
    });
    expect(home().readOnly).toBe(true);
    expect(home().toast?.message).toBe('Couldn’t save. Saving is paused until next month.');
  });
});

describe('outside server mode', () => {
  class MemoryStorage implements StorageLike {
    private map = new Map<string, string>();
    getItem(key: string) {
      return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.map.set(key, value);
    }
    removeItem(key: string) {
      this.map.delete(key);
    }
  }

  it('has no Welcome working-out, no read-only, and the server actions refuse', async () => {
    const home = mount(new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 }));
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    expect(home().serverWelcome).toBeNull();
    expect(home().readOnly).toBe(false);
    for (const run of [() => home().redeemCode('ABCD-EFGH'), () => home().createCode('x'), () => home().listDevices(), () => home().bringHomeOnline('x')]) {
      await expect(run()).rejects.toBeInstanceOf(BackendError);
    }
  });
});

describe('what a failed save says in server mode', () => {
  it('says the home is full when it reached its size limit', async () => {
    const { notSavedMessage } = await import('./HomeProvider');
    expect(notSavedMessage(new BackendError('unknown', 'too_large: The home is full'))).toBe('Couldn’t save. The home is full.');
    expect(notSavedMessage(new BackendError('unknown', 'busy: The home is busy'))).toBe('Couldn’t save. Try again.');
  });
});
