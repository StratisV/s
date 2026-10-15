/**
 * Each Home area's card sits in a panel marked `data-area-panel`, which also carries
 * `data-collapsed` while the area is collapsed (set during render, before it goes inert).
 */

/**
 * True for an element inside a collapsed area's card: it can't take focus (it is inert and
 * hidden), so code that moves focus to a nearby row skips it.
 */
export function inCollapsedArea(el: Element): boolean {
  return !!el.closest('[data-area-panel][data-collapsed]');
}

/**
 * Home has two lists of rows: the chosen day's under the calendar (`data-calendar`) and the
 * areas'. The rows in `row`'s own list (in `root`), in order: code that moves focus to a
 * nearby row stays in that list.
 */
export function rowsBeside(row: Element, root: ParentNode = document): HTMLElement[] {
  const calendar = row.closest('[data-calendar]');
  const rows = Array.from((calendar ?? root).querySelectorAll<HTMLElement>('[data-item-open]'));
  return calendar ? rows : rows.filter((el) => !el.closest('[data-calendar]'));
}

/**
 * Where focus goes when no row is left near one in `section`: the room's name (Rooms), the
 * group's heading (Up next), or under the calendar, the chosen day's button, or its heading
 * under the calendar when that day isn't on the grid (another month or week is shown).
 */
export function rowFallback(section: Element | null | undefined): HTMLElement | null {
  if (!section) return null;
  if (!section.hasAttribute('data-calendar')) {
    return (
      section.querySelector<HTMLElement>('h2 button[aria-expanded]') ?? section.querySelector<HTMLElement>('h2[tabindex]')
    );
  }
  return (
    section.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"] > button') ??
    section.querySelector<HTMLElement>('[data-calendar-day] h3[tabindex]')
  );
}
