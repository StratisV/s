/**
 * `?frame` in the URL simulates the iPhone status bar inset (54px) in a
 * desktop browser, so screenshots line up with design/reference/*.png.
 * Cosmetic only.
 */
export function applyPreviewInset(): void {
  try {
    if (new URLSearchParams(window.location.search).has('frame')) {
      document.documentElement.style.setProperty('--top-inset', '54px');
    }
  } catch {
    /* not in a browser */
  }
}
