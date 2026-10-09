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
