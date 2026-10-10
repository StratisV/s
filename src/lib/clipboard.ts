/**
 * Copies text to the clipboard; resolves to whether it worked. Plain-http origins (a phone
 * on the dev server) have no Clipboard API, so it falls back to execCommand there, putting
 * focus back where it was.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* no permission or not a secure context: try the old way */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // 16px so iOS doesn't zoom in on it.
    Object.assign(area.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      opacity: '0',
      pointerEvents: 'none',
      fontSize: '16px',
    });
    const previous = document.activeElement as HTMLElement | null;
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    previous?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}
