import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionSheet } from './ActionSheet';

function Harness({
  title = 'Delete Garden?',
  message = 'Its 2 items will be deleted too.',
  onDelete = () => {},
  moveFocus = false,
}: {
  title?: string;
  message?: string;
  onDelete?(): void;
  moveFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <>
      {gone ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Delete Garden
        </button>
      )}
      <button type="button">Add Area</button>
      <ActionSheet
        open={open}
        title={title || undefined}
        message={message || undefined}
        actions={[
          {
            label: 'Delete Area',
            destructive: true,
            onSelect: () => {
              setOpen(false);
              onDelete();
              if (moveFocus) screen.getByRole('button', { name: 'Add Area' }).focus();
              else setGone(true);
            },
          },
        ]}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

async function openSheet() {
  const trigger = screen.getByRole('button', { name: 'Delete Garden' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const sheet = await screen.findByRole('alertdialog');
  return { trigger, sheet };
}

afterEach(() => cleanup());

describe('ActionSheet', () => {
  it('is named by its title and described by its message', async () => {
    render(<Harness />);
    await openSheet();
    expect(
      screen.getByRole('alertdialog', { name: 'Delete Garden?', description: 'Its 2 items will be deleted too.' }),
    ).toBeTruthy();
  });

  it('falls back to "Confirm" without a title', async () => {
    render(<Harness title="" message="" />);
    const { sheet } = await openSheet();
    expect(sheet.getAttribute('aria-label')).toBe('Confirm');
    expect(sheet.hasAttribute('aria-labelledby')).toBe(false);
    expect(sheet.hasAttribute('aria-describedby')).toBe(false);
  });

  it('focuses Cancel first, the least destructive choice', async () => {
    render(<Harness />);
    await openSheet();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
  });

  it('ignores a held Enter, so auto-repeat cannot confirm', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    await openSheet();
    const del = screen.getByRole('button', { name: 'Delete Area' });
    const reached = vi.fn();
    del.addEventListener('keydown', reached);
    const held = createEvent.keyDown(del, { key: 'Enter', repeat: true });
    fireEvent(del, held);
    expect(held.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    const pressed = createEvent.keyDown(del, { key: 'Enter' });
    fireEvent(del, pressed);
    expect(pressed.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('gives focus back to the trigger on Cancel and on Escape', async () => {
    render(<Harness />);
    let { trigger } = await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeTruthy(); // still animating out
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    ({ trigger } = await openSheet());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('leaves focus where the action put it', async () => {
    render(<Harness moveFocus />);
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Area' }));
  });

  it('does not try to focus a trigger the action removed', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Delete Garden' })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
