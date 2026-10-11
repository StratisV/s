// Which backend a build is for, decided once from the build's environment and used by
// vite.config.ts (the client's VITE_HOMEOS_SERVER) and scripts/build-server.mjs (whether to
// publish the server). docs/ARCHITECTURE.md "Server mode (no setup)", "Choosing the backend".
// src/lib/backend/index.ts (pickBackendMode) applies the same order in the browser.
//
// Only the presence of secrets is read here, never their values beyond the public Supabase
// URL and anon key (which the browser needs anyway).

/** The first of `names` that is set: the app's own VITE_ name, then what the Vercel and Supabase integration provides. */
function pick(env, ...names) {
  for (const name of names) if (env[name]) return env[name];
  return '';
}

/** The public Supabase settings the browser needs ('' when not configured). */
export function supabaseSettings(env) {
  return {
    url: pick(env, 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
    anonKey: pick(
      env,
      'VITE_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
    ),
  };
}

/**
 * 'demo' when forced (VITE_FORCE_DEMO=1), else 'supabase' when its URL and key are set, else
 * 'server' when the deployment has a Blob store (BLOB_READ_WRITE_TOKEN is set) or a local build
 * asks for the local server (HOMEOS_LOCAL_SERVER=1), else 'demo'.
 */
export function backendMode(env) {
  if (env.VITE_FORCE_DEMO === '1') return 'demo';
  const supabase = supabaseSettings(env);
  if (supabase.url && supabase.anonKey) return 'supabase';
  if (env.BLOB_READ_WRITE_TOKEN || env.HOMEOS_LOCAL_SERVER === '1') return 'server';
  return 'demo';
}
