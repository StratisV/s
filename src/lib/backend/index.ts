import type { Backend } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type BackendMode = 'demo' | 'supabase' | 'server';

/**
 * Which backend a build runs (docs/ARCHITECTURE.md "Server mode (no setup)", "Choosing the
 * backend"), in this order: demo when forced (VITE_FORCE_DEMO=1, the e2e tests), Supabase when
 * it is configured, this deployment's own server when the build had one (VITE_HOMEOS_SERVER,
 * set by vite.config.ts from the presence of BLOB_READ_WRITE_TOKEN, never its value), else
 * demo. scripts/backend-mode.mjs decides the same way at build time.
 */
export function pickBackendMode(env: {
  forceDemo?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  server?: string;
}): BackendMode {
  if (env.forceDemo === '1') return 'demo';
  if (env.supabaseUrl && env.supabaseKey) return 'supabase';
  if (env.server === '1') return 'server';
  return 'demo';
}

export const BACKEND_MODE: BackendMode = pickBackendMode({
  forceDemo: import.meta.env.VITE_FORCE_DEMO,
  supabaseUrl: url,
  supabaseKey: anonKey,
  server: import.meta.env.VITE_HOMEOS_SERVER,
});

/** Demo mode: data lives in this browser only. */
export const IS_DEMO = BACKEND_MODE === 'demo';

export async function createBackend(): Promise<Backend> {
  switch (BACKEND_MODE) {
    case 'demo': {
      const { DemoBackend } = await import('./demo');
      return new DemoBackend();
    }
    case 'supabase': {
      const { SupabaseBackend } = await import('./supabase');
      return new SupabaseBackend(url!, anonKey!);
    }
    case 'server': {
      const { ServerBackend } = await import('./server');
      return new ServerBackend();
    }
  }
}

export * from './types';
