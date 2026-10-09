// Registers public/sw.js (offline app shell and Web Push) in production builds.
// In dev, push.ts registers it on demand when someone turns notifications on.

let warned = false;

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('home.os: service worker setup failed', err);
}

/** Never throws. Call once at boot; it waits for the page to finish loading. */
export function registerServiceWorker(): void {
  try {
    if (!import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    const register = () => {
      const base = import.meta.env.BASE_URL;
      // A new worker (first visit, or an update) took over: it may not have this page's assets.
      sw.addEventListener('controllerchange', () => cacheLoadedAssets(sw.controller));
      sw.register(`${base}sw.js`, { scope: base })
        .then(() => sw.ready)
        .then((registration) => cacheLoadedAssets(registration.active))
        .catch(warnOnce);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  } catch (err) {
    warnOnce(err);
  }
}

/**
 * Tells the worker which build assets this page loaded. Some (fonts, lazy chunks) load before
 * the worker controls the page, so it never sees them; this lets the next launch work offline.
 */
function cacheLoadedAssets(worker: ServiceWorker | null | undefined): void {
  try {
    if (!worker) return;
    const assets = new URL(`${import.meta.env.BASE_URL}assets/`, window.location.href).href;
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(assets));
    if (urls.length > 0) worker.postMessage({ type: 'cache-assets', urls });
  } catch (err) {
    warnOnce(err);
  }
}
