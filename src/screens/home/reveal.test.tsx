import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealRow } from './reveal';

/**
 * A tab's scroll area as Screen draws it at 402 by 874 (64px under the docked tab switch, 104px
 * of room for the round + at the bottom), drawn at `scale` (the page behind a closing sheet is
 * still pushed back), and a row in it at `top` (screen px) that is `height` tall.
 */
function layout(top: number, height = 66, scale = 1) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const row = document.createElement('li');
  scroller.appendChild(row);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, 'offsetHeight', { value: 874 });
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 402 * scale, 874 * scale);
  row.getBoundingClientRect = () => new DOMRect(16, top, 370, height);
  const real = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    if (el !== scroller) return real(el, pseudo);
    return { overflowY: 'auto', scrollPaddingTop: '64px', paddingBottom: '104px' } as CSSStyleDeclaration;
  });
  const scrollBy = vi.fn();
  scroller.scrollBy = scrollBy as typeof scroller.scrollBy;
  return { row, scrollBy };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('revealRow', () => {
  it('brings a row at the bottom edge up clear of the round +, whole', () => {
    // At 402 by 874 the saved row ended flush with the screen's edge, under the + (808 to 874).
    const { row, scrollBy } = layout(808);
    revealRow(row, true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 104, behavior: 'smooth' });
  });

  it('counts in the page’s own pixels while it is still pushed back behind the sheet', () => {
    const scale = 0.91;
    const { row, scrollBy } = layout(808 * scale, 66 * scale, scale);
    revealRow(row, false);
    expect(scrollBy.mock.calls[0][0].top).toBeCloseTo(104, 5);
    expect(scrollBy.mock.calls[0][0].behavior).toBe('auto');
  });

  it('never takes a row’s top up under the docked tab switch', () => {
    const { row, scrollBy } = layout(100, 800);
    revealRow(row, true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 36, behavior: 'smooth' });
  });

  it('brings a row under the tab switch down, and leaves one in the clear where it is', () => {
    const above = layout(20);
    revealRow(above.row, true);
    expect(above.scrollBy).toHaveBeenCalledWith({ top: -44, behavior: 'smooth' });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    const clear = layout(400);
    revealRow(clear.row, true);
    expect(clear.scrollBy).not.toHaveBeenCalled();
  });
});
