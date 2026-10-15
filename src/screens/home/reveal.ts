import { createContext } from 'react';
import { scrollParent } from '../../ui/DatePicker';

/**
 * The item Home is bringing into view after it was saved (HomeScreen's `revealItem`), for a
 * moment: a "Show N more" over it opens (ShowMore.tsx), the calendar goes to its day, and its
 * row lights up. Null the rest of the time.
 */
export const RevealContext = createContext<string | null>(null);

/**
 * Scrolls a row just saved (`row`, its `li`) into the clear part of the tab's scroll area:
 * whole, above the floating + (the scroll area's bottom padding) and below the docked tab
 * switch (its `scroll-padding-top`), moving as little as it can. Measured, as `scrollIntoView`
 * stopped short: Chromium cut the rows' scroll margins at their cards' clipped edges, which
 * left the row under the +. Distances are taken at the screen's scale, as the page behind the
 * closing sheet is still pushed back (scaled) when this runs.
 */
export function revealRow(row: HTMLElement, smooth: boolean): void {
  const scroller = scrollParent(row);
  if (!scroller || !scroller.offsetHeight) return;
  const style = getComputedStyle(scroller);
  const box = scroller.getBoundingClientRect();
  const scale = box.height / scroller.offsetHeight || 1;
  const top = box.top + (parseFloat(style.scrollPaddingTop) || 0) * scale;
  const bottom = box.bottom - (parseFloat(style.paddingBottom) || 0) * scale;
  const { top: rowTop, bottom: rowBottom } = row.getBoundingClientRect();
  // Up until its bottom clears the + (never taking its top under the tab switch), or down.
  const delta = rowBottom > bottom ? Math.min(rowBottom - bottom, rowTop - top) : rowTop < top ? rowTop - top : 0;
  if (Math.abs(delta) > 1) scroller.scrollBy?.({ top: delta / scale, behavior: smooth ? 'smooth' : 'auto' });
}
