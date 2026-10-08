import type { Backend } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Demo mode when Supabase isn't configured: data lives in this browser only. */
export const IS_DEMO = !url || !anonKey;

export async function createBackend(): Promise<Backend> {
  if (IS_DEMO) {
    const { DemoBackend } = await import('./demo');
    return new DemoBackend();
  }
  const { SupabaseBackend } = await import('./supabase');
  return new SupabaseBackend(url!, anonKey!);
}

export * from './types';
