/**
 * Lists of rows and where focus goes between them. Rows live in two kinds of list: an area's
 * sheet (a dialog), and Needs attention's cards.
 */

/**
 * The rows in `row`'s own list (in `root`), in order: the sheet it is in, else every row in
 * `root`. Code that moves focus to a nearby row stays in that list.
 */
export function rowsBeside(row: Element, root: ParentNode = document): HTMLElement[] {
  const scope = row.closest('[role="dialog"]') ?? root;
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-item-open]'));
}

/**
 * Where focus goes when no row is left near one in `section`: the section's heading (To do or
 * Looking after in an area's sheet), else what it marks as the place to go
 * (`data-row-fallback`: Needs attention's sentence, which then says what is left).
 */
export function rowFallback(section: Element | null | undefined): HTMLElement | null {
  if (!section) return null;
  return section.querySelector<HTMLElement>('h2[tabindex]') ?? section.querySelector<HTMLElement>('[data-row-fallback]');
}
