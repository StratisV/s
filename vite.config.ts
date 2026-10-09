/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** The first of `names` that is set: the app's own VITE_ name, then what the Vercel and Supabase integration provides. */
function pick(env: Record<string, string>, ...names: string[]): string {
  for (const name of names) if (env[name]) return env[name];
  return '';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = pick(env, 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseKey = pick(
    env,
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  );
  return {
    base: env.VITE_BASE || '/',
    // Public by design (the browser needs them); a connected Supabase project switches demo mode off.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseKey),
    },
    plugins: [react()],
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
      environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    },
  };
});
