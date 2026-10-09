/* home.os service worker. Plain JS with no build step: public/ is copied into dist as-is.
 *
 * - Navigations: network first; offline, the cached app shell (index page).
 * - Hashed build assets under <scope>assets/: cache first (their names change with every build).
 * - Everything else (Supabase, Google, other origins, the manifest, icons) goes straight to
 *   the network and is never cached.
 * - Web Push: shows the scheduler's notifications and opens the app when one is tapped.
 *
 * Bump VERSION when the caching rules change; activate deletes this app's older caches.
 */
const VERSION = 'v1';

// The app may live under a sub-path (VITE_BASE), so every URL is built from the scope.
const SCOPE = self.registration.scope; // e.g. https://example.com/ or https://example.com/home/
const SHELL_URL = SCOPE;
const ASSETS_URL = new URL('assets/', SCOPE).href;
const ICON_URL = new URL('icons/icon-192.png', SCOPE).href;

// Caches are shared by every app on this origin: scope the names so two deployments on
// different sub-paths never delete each other's caches.
const CACHE_PREFIX = `home.os:${new URL(SCOPE).pathname}:`;
const CACHE = CACHE_PREFIX + VERSION;

/** Old hashed assets pile up across deploys; keep the newest ones. */
const MAX_ASSETS = 80;

// ── Lifecycle ──────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * Best effort, so the very next launch works offline: the index page and the assets it
 * links. Never fails the install (it may be running offline).
 */
async function precacheShell() {
  try {
    const response = await fetch(SHELL_URL, { cache: 'no-cache' });
    if (!isShellResponse(response)) return;
    const cache = await caches.open(CACHE);
    const html = await response.clone().text();
    await cache.put(SHELL_URL, await cleanCopy(response));
    await cacheAssets(cache, linkedAssets(html));
  } catch {
    /* offline or the host is down: the first online navigation caches it instead */
  }
}

// ── Fetch ──────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, url));
  } else if (url.href.startsWith(ASSETS_URL)) {
    event.respondWith(cacheFirst(event));
  }
  // Anything else falls through to the network untouched.
});

async function navigate(event, url) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    // Only the app's own page becomes the shell, stored without its query string (it can
    // carry an OAuth code or an invite token). Other paths, like an icon opened in a tab,
    // are passed through.
    if (isShellPath(url) && isShellResponse(response)) {
      const copy = response.clone();
      event.waitUntil(
        (async () => {
          const cache = await caches.open(CACHE);
          await cache.put(SHELL_URL, await cleanCopy(copy));
        })().catch(() => {}),
      );
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(SHELL_URL)) || offlinePage();
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.status === 200 && response.type === 'basic') {
    const copy = response.clone();
    event.waitUntil(
      cache
        .put(event.request, copy)
        .then(() => trimAssets(cache))
        .catch(() => {}),
    );
  }
  return response;
}

// ── Messages from the page ─────────────────────────────────

// src/lib/sw-register.ts sends the assets the page has loaded: on the first visit (and after
// an update) some were fetched before this worker took control, like fonts and lazy chunks.
// This way the app also works offline from the second launch.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-assets' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cacheAssets(cache, data.urls))
      .catch(() => {}),
  );
});

// ── Push ───────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const { title, body, url, tag } = readPush(event.data);
  const options = {
    body,
    icon: ICON_URL,
    badge: ICON_URL,
    data: { url },
    renotify: false,
  };
  if (tag) options.tag = tag;
  // iOS revokes the subscription after silent pushes, so always show something.
  event.waitUntil(self.registration.showNotification(title, options));
});

/** The scheduler sends JSON { title, body, url, tag }; anything else becomes the body. */
function readPush(data) {
  let payload = {};
  if (data) {
    try {
      payload = data.json();
    } catch {
      payload = { body: data.text() };
    }
  }
  if (!payload || typeof payload !== 'object') payload = { body: String(payload ?? '') };
  return {
    title: nonEmpty(payload.title) || 'home.os',
    body: typeof payload.body === 'string' ? payload.body : '',
    url: resolveUrl(payload.url),
    tag: nonEmpty(payload.tag),
  };
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolveUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(openApp(url));
});

/** Focus an open home.os window (moving it to url if needed), or open a new one. */
async function openApp(url) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ours = windows.filter((client) => client.url.startsWith(SCOPE));
  const client = ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === 'visible') || ours[0];
  if (client) {
    let focused = client;
    try {
      focused = (await client.focus()) || client;
    } catch {
      /* not allowed to focus: still try to navigate */
    }
    if (focused.url !== url && typeof focused.navigate === 'function') {
      try {
        await focused.navigate(url);
      } catch {
        /* an uncontrolled window can't be navigated from here; it is focused at least */
      }
    }
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(url);
}

// ── Helpers ────────────────────────────────────────────────

function isShellPath(url) {
  const path = url.pathname;
  const scopePath = new URL(SCOPE).pathname;
  return path === scopePath || path === `${scopePath}index.html`;
}

function isShellResponse(response) {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    (response.headers.get('content-type') || '').includes('text/html')
  );
}

/**
 * A copy without the "redirected" flag: Safari refuses to answer a navigation with a
 * response that was redirected.
 */
async function cleanCopy(response) {
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Asset URLs linked from the index page (scripts, styles, module preloads). */
function linkedAssets(html) {
  const urls = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    try {
      urls.push(new URL(match[1], SCOPE).href);
    } catch {
      /* not a URL */
    }
  }
  return urls;
}

async function cacheAssets(cache, urls) {
  const wanted = [...new Set(urls)].filter((url) => typeof url === 'string' && url.startsWith(ASSETS_URL));
  await Promise.allSettled(
    wanted.map(async (url) => {
      const cached = await cache.match(url);
      // Still in use: put it back so trimming treats it as new (fonts rarely change).
      if (cached) return cache.put(url, cached);
      const response = await fetch(url);
      if (response.status === 200 && response.type === 'basic') await cache.put(url, response);
    }),
  );
  await trimAssets(cache);
}

/** Cache keys come back oldest first: drop the oldest assets over the limit. */
async function trimAssets(cache) {
  const assets = (await cache.keys()).filter((request) => request.url.startsWith(ASSETS_URL));
  const extra = assets.length - MAX_ASSETS;
  if (extra > 0) await Promise.all(assets.slice(0, extra).map((request) => cache.delete(request)));
}

function resolveUrl(value) {
  if (typeof value === 'string' && value.trim()) {
    try {
      return new URL(value, SCOPE).href;
    } catch {
      /* fall back to the app */
    }
  }
  return SCOPE;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function offlinePage() {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<title>home.os</title></head>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F2F7;' +
    'font:17px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#6E6E73;text-align:center;padding:24px">' +
    '<p>You are offline.<br>home.os will open once you are back online.</p></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
