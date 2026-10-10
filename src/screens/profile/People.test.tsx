import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import { TEXT_LIMITS } from '../../lib/constants';
import type { Member, NewPersonInput } from '../../lib/types';
import type { HomeContextValue } from '../../state/HomeProvider';
import { makeHome, MockHome, mockHome, person, setHome, updateHome } from '../testing/mockHome';
import { removeMessage } from './PersonPage';
import { ProfileScreen } from './ProfileScreen';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

function Cover() {
  const [open, setOpen] = useState(true);
  return <ProfileScreen open={open} onClose={() => setOpen(false)} />;
}

/** What the provider does: the new person is in data.members once addPerson resolves. */
function addsPeople(over: Partial<HomeContextValue> = {}): HomeContextValue {
  let n = 0;
  return makeHome({
    addPerson: vi.fn(async (input: NewPersonInput) => {
      n += 1;
      const added: Member = person({ id: `m-new-${n}`, name: input.name, emoji: input.emoji || '🦔', email: input.email });
      setHome((h) => ({ data: { ...h.data!, members: [...h.data!.members, added] } }));
      return added;
    }),
    ...over,
  });
}

async function openPeople(home: HomeContextValue = addsPeople()) {
  // StrictMode as in main.tsx: effects run twice on mount.
  render(
    <StrictMode>
      <MockHome initial={home}>
        <Cover />
      </MockHome>
    </StrictMode>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Profile' });
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: /^Household/ }));
  await screen.findByRole('heading', { name: 'Household', level: 1 });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Profile' })));
  return { home, people: screen.getByRole('region', { name: 'People' }) };
}

/** The Add Person page (its bar and content). */
function addPage(): HTMLElement {
  return screen.getByRole('heading', { level: 1, name: 'Add Person' }).parentElement!.parentElement!;
}

async function openAddPerson() {
  fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));
  await screen.findByRole('heading', { level: 1, name: 'Add Person' });
  const name = within(addPage()).getByRole('textbox', { name: 'Name' });
  // It starts in Name once it has slid in.
  await waitFor(() => expect(document.activeElement).toBe(name));
  return name as HTMLInputElement;
}

async function openPersonPage(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  const heading = await screen.findByRole('heading', { level: 1, name });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Household' })));
  return heading.parentElement as HTMLElement;
}

const emailField = () => screen.getByRole('textbox', { name: 'Google Email' }) as HTMLInputElement;
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
const members = () => mockHome.value.data!.members;

afterEach(() => cleanup());

describe('People: who has joined', () => {
  it('lists everyone in member order, saying who has not joined yet and with which email', async () => {
    const { people } = await openPeople();
    const rows = within(people).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      '🦆Stratis, You',
      '🦔Shea, Not joined yet · , shea@gmail.com',
      '🐻Pat, Not joined yet · , No email yet',
      'Add Person',
    ]);
    // What the eye sees: the dot, no commas.
    const shea = rows[1];
    expect(within(shea).getByText('shea@gmail.com', { exact: false }).getAttribute('class')).toMatch(/addressText/);
    expect(within(shea).getByText('·').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Add Person', () => {
  it('adds someone by name, emoji and Google email, and their row takes focus', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    expect(screen.getByRole('heading', { level: 1, name: 'Add Person' })).toBeTruthy();
    expect(name.maxLength).toBe(TEXT_LIMITS.memberName);
    // The first emoji nobody at home has: Stratis has the duck, Shea the hedgehog, so the fox.
    const grid = screen.getByRole('radiogroup', { name: 'Emoji' });
    expect(within(grid).getByRole('radio', { name: '🦊' }).getAttribute('aria-checked')).toBe('true');
    expect(within(grid).getByRole('radio', { name: '🦔' }).getAttribute('aria-checked')).toBe('false');

    const email = emailField();
    expect(email.type).toBe('email');
    expect(email.inputMode).toBe('email');
    expect(email.getAttribute('autocapitalize')).toBe('none');
    expect(email.getAttribute('autocorrect')).toBe('off');
    expect(email.getAttribute('spellcheck')).toBe('false');
    expect(email.maxLength).toBe(TEXT_LIMITS.email);
    expect(email.placeholder).toBe('name@gmail.com');
    const note = 'When they sign in with Google using this email, they join as this person, with their items.';
    expect(screen.getByText(note).id).toBe(email.getAttribute('aria-describedby'));

    // Off while the name is blank.
    expect(addButton().disabled).toBe(true);
    fireEvent.change(name, { target: { value: '  Ela ' } });
    expect(addButton().disabled).toBe(false);
    fireEvent.click(within(grid).getByRole('radio', { name: '🦊' }));
    fireEvent.change(email, { target: { value: ' Ela.Moss@Gmail.com ' } });
    fireEvent.click(addButton());

    await waitFor(() => expect(home.addPerson).toHaveBeenCalledTimes(1));
    expect(home.addPerson).toHaveBeenCalledWith({ name: 'Ela', emoji: '🦊', email: 'ela.moss@gmail.com' });
    // Back on Household, with Ela in People and focus on her row.
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Add Person' })).toBeNull());
    const row = within(screen.getByRole('region', { name: 'People' })).getByRole('button', { name: /^Ela\b/ });
    expect(row.textContent).toBe('🦊Ela, Not joined yet · , ela.moss@gmail.com');
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('adds someone without an email (to add later)', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(home.addPerson).toHaveBeenCalledWith({ name: 'Robin', emoji: '🦊', email: '' }));
    await waitFor(() => expect(members().map((m) => m.name)).toContain('Robin'));
  });

  it('Return in Name moves to the email; Return there adds', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(document.activeElement).toBe(emailField());
    expect(home.addPerson).not.toHaveBeenCalled();
    fireEvent.change(emailField(), { target: { value: 'robin@gmail.com' } });
    fireEvent.keyDown(emailField(), { key: 'Enter' });
    await waitFor(() => expect(home.addPerson).toHaveBeenCalledWith({ name: 'Robin', emoji: '🦊', email: 'robin@gmail.com' }));
  });

  it('is off while the email is not one, and says so once the field is left', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    const email = emailField();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'robin@gmail' } });
    expect(addButton().disabled).toBe(true);
    // Not while typing.
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => email.blur());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Enter the full email address, like name@gmail.com.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')!.split(' ')).toContain(alert.id);
    fireEvent.change(email, { target: { value: 'robin@gmail.com' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(addButton().disabled).toBe(false);
    expect(home.addPerson).not.toHaveBeenCalled();
  });

  it('says when someone at home already has that email, and keeps everything typed', async () => {
    const { home } = await openPeople(
      addsPeople({ addPerson: vi.fn(async () => Promise.reject(new BackendError('email_taken'))) }),
    );
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Emoji' })).getByRole('radio', { name: '🐳' }));
    fireEvent.change(emailField(), { target: { value: 'robin@gmail.com' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(home.addPerson).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('alert')).textContent).toBe('Someone at home already has that email.');
    expect(screen.getByRole('heading', { level: 1, name: 'Add Person' })).toBeTruthy();
    expect(name.value).toBe('Robin');
    expect(emailField().value).toBe('robin@gmail.com');
    expect(within(addPage()).getByRole('radio', { name: '🐳' }).getAttribute('aria-checked')).toBe('true');
    expect(addButton().getAttribute('aria-busy')).toBeNull();
    // Typing again clears it.
    fireEvent.change(emailField(), { target: { value: 'robin2@gmail.com' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('spots an email someone at home already has before Add', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    const email = emailField();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'SHEA@gmail.com' } });
    act(() => email.blur());
    expect(screen.getByRole('alert').textContent).toBe('Someone at home already has that email.');
    expect(home.addPerson).not.toHaveBeenCalled();
  });

  it('shows other failures under the field too', async () => {
    await openPeople(addsPeople({ addPerson: vi.fn(async () => Promise.reject(new BackendError('network'))) }));
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toBe('No connection. Try again in a moment.');
  });

  it('is busy while adding, and a second tap does nothing', async () => {
    let finish!: () => void;
    const base = addsPeople();
    const add = base.addPerson;
    const { home } = await openPeople({
      ...base,
      addPerson: vi.fn(async (input: NewPersonInput) => {
        await new Promise<void>((r) => (finish = r));
        return add(input);
      }),
    });
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.click(addButton());
    expect(addButton().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(addButton());
    expect(home.addPerson).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Add Person' })).toBeNull());
  });

  it('Back (or Escape) leaves without adding, focus back on Add Person', async () => {
    const { home } = await openPeople();
    const name = await openAddPerson();
    fireEvent.change(name, { target: { value: 'Robin' } });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Add Person' })).toBeNull());
    expect(home.addPerson).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Person' })));
    // Opens fresh next time.
    const again = await openAddPerson();
    expect(again.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Household' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Add Person' })).toBeNull());
  });
});

describe("A person's page", () => {
  it('for someone who has not joined: Not joined yet, their email and Remove', async () => {
    await openPeople();
    const page = await openPersonPage('Shea');
    expect(within(page).getByText('Not joined yet')).toBeTruthy();
    expect(emailField().value).toBe('shea@gmail.com');
    expect(
      screen.getByText('When they sign in with Google using this email, they join as this person, with their items.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Shea' })).toBeTruthy();
  });

  it('for someone who has joined: no email field and no Remove', async () => {
    await openPeople();
    const page = await openPersonPage('Stratis');
    expect(within(page).getByText('stratis@gmail.com')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Google Email' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(within(page).queryByText('Not joined yet')).toBeNull();
  });

  it('saves the email on Return or when the field is left, as it is stored', async () => {
    const { home } = await openPeople(
      addsPeople({
        setPersonEmail: vi.fn(async (id: string, email: string) =>
          setHome((h) => ({ data: { ...h.data!, members: h.data!.members.map((m) => (m.id === id ? { ...m, email } : m)) } })),
        ),
      }),
    );
    await openPersonPage('Pat');
    const email = emailField();
    expect(email.value).toBe('');
    act(() => email.focus());
    fireEvent.change(email, { target: { value: ' Pat@Example.com ' } });
    fireEvent.keyDown(email, { key: 'Enter' });
    await waitFor(() => expect(home.setPersonEmail).toHaveBeenCalledWith('m-pat', 'pat@example.com'));
    expect(email.value).toBe('pat@example.com');

    // Leaving the field saves too; the same value again is not sent.
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'pat@example.com' } });
    act(() => email.blur());
    expect(home.setPersonEmail).toHaveBeenCalledTimes(1);
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'pat.b@example.com' } });
    act(() => email.blur());
    await waitFor(() => expect(home.setPersonEmail).toHaveBeenLastCalledWith('m-pat', 'pat.b@example.com'));

    // Blank clears it.
    act(() => email.focus());
    fireEvent.change(email, { target: { value: '  ' } });
    act(() => email.blur());
    await waitFor(() => expect(home.setPersonEmail).toHaveBeenLastCalledWith('m-pat', ''));
    expect(home.setPersonEmail).toHaveBeenCalledTimes(3);
  });

  it('keeps an email that is not one, says why, and saves nothing', async () => {
    const { home } = await openPeople();
    await openPersonPage('Shea');
    const email = emailField();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'shea at gmail' } });
    act(() => email.blur());
    expect(screen.getByRole('alert').textContent).toBe('Enter the full email address, like name@gmail.com.');
    expect(email.value).toBe('shea at gmail');
    expect(home.setPersonEmail).not.toHaveBeenCalled();
  });

  it('keeps the text and says so when someone at home already has the email', async () => {
    await openPeople(addsPeople({ setPersonEmail: vi.fn(async () => Promise.reject(new BackendError('email_taken'))) }));
    await openPersonPage('Pat');
    const email = emailField();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'stratis@gmail.com' } });
    fireEvent.keyDown(email, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Someone at home already has that email.');
    expect(email.value).toBe('stratis@gmail.com');
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });

  it('Escape puts the saved email back and stays on the page', async () => {
    const { home } = await openPeople();
    await openPersonPage('Shea');
    const email = emailField();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: 'someone@else.com' } });
    fireEvent.keyDown(email, { key: 'Escape' });
    expect(email.value).toBe('shea@gmail.com');
    expect(home.setPersonEmail).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Shea' })).toBeTruthy();
  });

  it('follows an email changed on another phone', async () => {
    await openPeople();
    await openPersonPage('Shea');
    updateHome((h) => ({
      data: { ...h.data!, members: h.data!.members.map((m) => (m.id === 'm-shea' ? { ...m, email: 'shea.b@gmail.com' } : m)) },
    }));
    expect(emailField().value).toBe('shea.b@gmail.com');
  });

  it('becomes an ordinary page when they sign in meanwhile', async () => {
    await openPeople();
    await openPersonPage('Shea');
    updateHome((h) => ({
      data: { ...h.data!, members: h.data!.members.map((m) => (m.id === 'm-shea' ? { ...m, user_id: 'user-shea' } : m)) },
    }));
    expect(screen.queryByRole('textbox', { name: 'Google Email' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Shea' })).toBeNull();
    expect(screen.getByText('shea@gmail.com')).toBeTruthy();
  });

  it('Remove says when what they did leaves Stats', async () => {
    const done = (id: string, credited: string | null) => ({
      id,
      household_id: 'h-1',
      item_id: null,
      item_title: 'Weeds',
      credited_to: credited,
      completed_by: credited,
      completed_at: '2026-10-07T10:00:00.000Z',
    });
    const base = addsPeople();
    await openPeople({
      ...base,
      data: { ...base.data!, completions: [done('c1', 'm-pat'), done('c2', 'm-pat'), done('c3', 'm-stratis')] },
    });
    await openPersonPage('Pat');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pat' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Remove Pat?' });
    expect(sheet.textContent).toContain('Their items become unassigned and their 2 done tasks leave Stats.');
  });

  it('Remove asks first, then removes them and goes back, focus on Add Person', async () => {
    const { home } = await openPeople(
      addsPeople({
        removePerson: vi.fn(async (id: string) =>
          setHome((h) => ({ data: { ...h.data!, members: h.data!.members.filter((m) => m.id !== id) } })),
        ),
      }),
    );
    await openPersonPage('Shea');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shea' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Remove Shea?' });
    expect(sheet.textContent).toContain('Their items become unassigned.');
    // Cancel first: nothing happens.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(home.removePerson).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Shea' }));
    const again = await screen.findByRole('alertdialog', { name: 'Remove Shea?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Remove' }));
    expect(home.removePerson).toHaveBeenCalledWith('m-shea');
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Shea' })).toBeNull());
    expect(members().map((m) => m.name)).toEqual(['Stratis', 'Pat']);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Person' })));
  });
});

describe('removeMessage', () => {
  it('says how many done tasks leave Stats with them, if any', () => {
    const c = (credited: string | null) => ({ credited_to: credited });
    expect(removeMessage({ id: 'm-pat' }, [])).toBe('Their items become unassigned.');
    expect(removeMessage({ id: 'm-pat' }, [c('m-shea'), c(null)])).toBe('Their items become unassigned.');
    expect(removeMessage({ id: 'm-pat' }, [c('m-pat'), c('m-shea')])).toBe(
      'Their items become unassigned and their 1 done task leaves Stats.',
    );
  });
});
