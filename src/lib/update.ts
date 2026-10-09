// Picks up a new deploy when the app comes back into view.
//
// An installed iPhone app (and a tab left open) keeps running the version it started with:
// it is resumed, not reloaded. So when the app comes back into view this asks the server
// for the index page, and if it names a different main script (every build has a new
// hashed name) the app reloads into the new version, unless something is being edited.

/** Not more often than this. */
const MIN_GAP_MS = 30_000;

const SCRIPT = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/;

/** The main script this page is running, as the index page names it. */
export function runningScript(doc: Document = document): string | null {
  const el = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.getAttribute('src') ?? null;
}

/** The main script named in an index page's HTML. */
export function scriptIn(html: string): string | null {
  return SCRIPT.exec(html)?.[1] ?? null;
}

/** Someone is in the middle of something: a sheet or dialog is open, or a field has focus. */
export function busy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = doc.activeElement;
  return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox'));
}

/**
 * Checks once: true when a different version is deployed. Never throws (offline, or the
 * host is down, is simply "no").
 */
export async function newVersionDeployed(base: string, doc: Document = document): Promise<boolean> {
  const running = runningScript(doc);
  if (!running) return false;
  try {
    const response = await fetch(base, { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!response.ok) return false;
    const next = scriptIn(await response.text());
    return !!next && next !== running;
  } catch {
    return false;
  }
}

/** Production builds only. Call once at boot. */
export function watchForUpdates(): void {
  if (!import.meta.env.PROD || typeof document === 'undefined') return;
  let last = 0;
  let checking = false;
  const check = async () => {
    if (document.visibilityState !== 'visible' || checking || Date.now() - last < MIN_GAP_MS) return;
    checking = true;
    last = Date.now();
    try {
      if ((await newVersionDeployed(import.meta.env.BASE_URL)) && !busy()) window.location.reload();
    } finally {
      checking = false;
    }
  };
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void check();
  });
  window.addEventListener('focus', () => void check());
}
