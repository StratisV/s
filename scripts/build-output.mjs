// Pure helpers for scripts/build-server.mjs: the Build Output API v3 files that publish the
// app and its server on Vercel (docs/ARCHITECTURE.md "Server mode (no setup)", "Deploying").

/**
 * vercel.json `headers` as Build Output routes, in the same order (each with `continue`, so
 * every matching rule adds its headers and a later rule wins on the same header, as
 * vercel.json's headers do), then the filesystem (static files and the function). Sources may
 * be literal paths with `(.*)` groups only; anything else throws, so a vercel.json change that
 * this can't carry over fails the build instead of being dropped.
 */
export function buildOutputConfig(vercelJson) {
  const routes = [];
  for (const rule of vercelJson.headers ?? []) {
    const headers = {};
    for (const { key, value } of rule.headers) headers[key] = value;
    routes.push({ src: sourceToRegex(rule.source), headers, continue: true });
  }
  routes.push({ handle: 'filesystem' });
  return { version: 3, routes };
}

/** "/assets/(.*)" → "^/assets/(.*)$"; literal parts escaped. */
export function sourceToRegex(source) {
  if (typeof source !== 'string' || !source.startsWith('/')) throw new Error(`build-output: unsupported source ${source}`);
  const parts = source.split('(.*)');
  for (const part of parts) {
    if (/[():*+?{}[\]|\\]/.test(part)) throw new Error(`build-output: unsupported source ${source}`);
  }
  return `^${parts.map((part) => part.replace(/[.^$]/g, '\\$&')).join('(.*)')}$`;
}

/** The function's .vc-config.json (Node launcher, ESM handler, helpers off). */
export function functionConfig({ region } = {}) {
  return {
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    maxDuration: 15,
    ...(region ? { regions: [region] } : {}),
  };
}

/** esbuild's banner for an ESM bundle that holds CommonJS dependencies (@vercel/blob's undici). */
export const ESM_REQUIRE_BANNER = "import { createRequire as __homeosCreateRequire } from 'node:module'; const require = __homeosCreateRequire(import.meta.url);";
