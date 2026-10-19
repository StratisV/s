/**
 * Lists of rows and where focus goes between them. Rows live in three kinds of list: the
 * chosen day's under the calendar (`data-calendar`), an area's sheet (a dialog), and Needs
 * attention's groups.
 */

/**
 * The rows in `row`'s own list (in `root`), in order: the calendar's chosen day, else the
 * sheet it is in, else every row in `root` outside the calendar. Code that moves focus to a
 * nearby row stays in that list.
 */
export function rowsBeside(row: Element, root: ParentNode = document): HTMLElement[] {
  const calendar = row.closest('[data-calendar]');
  if (calendar) return Array.from(calendar.querySelectorAll<HTMLElement>('[data-item-open]'));
  const scope = row.closest('[role="dialog"]') ?? root;
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-item-open]')).filter((el) => !el.closest('[data-calendar]'));
}

/**
 * Where focus goes when no row is left near one in `section`: the section's heading (a group
 * on Needs attention, To do or Looking after in an area's sheet), or under the calendar, the
 * chosen day's button, or its heading under the calendar when that day isn't on the grid
 * (another month or week is shown).
 */
export function rowFallback(section: Element | null | undefined): HTMLElement | null {
  if (!section) return null;
  if (!section.hasAttribute('data-calendar')) return section.querySelector<HTMLElement>('h2[tabindex]');
  return (
    section.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"] > button') ??
    section.querySelector<HTMLElement>('[data-calendar-day] h3[tabindex]')
  );
}
