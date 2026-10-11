/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { backendMode, supabaseSettings } from './scripts/backend-mode.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabase = supabaseSettings(env);
  // docs/ARCHITECTURE.md "Server mode (no setup)": only whether the deployment has its own
  // server reaches the browser, never the Blob token itself.
  const server = backendMode(env) === 'server';
  return {
    base: env.VITE_BASE || '/',
    // Public by design (the browser needs them); a connected Supabase project switches demo mode off.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabase.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabase.anonKey),
      'import.meta.env.VITE_HOMEOS_SERVER': JSON.stringify(server ? '1' : ''),
    },
    plugins: [react()],
    // `npm run dev:server`: the local API server (server/entry/local.ts) behind the dev server.
    server: {
      port: 5173,
      host: true,
      ...(env.HOMEOS_API_PROXY ? { proxy: { '/api': { target: env.HOMEOS_API_PROXY, changeOrigin: false } } } : {}),
    },
    preview: { port: 4173, host: true },
    test: {
      globals: true,
      environment: 'node',
      include: [
        'src/**/*.test.{ts,tsx}',
        'supabase/functions/_shared/**/*.test.ts',
        'server/**/*.test.ts',
        'scripts/**/*.test.ts',
      ],
      environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    },
  };
});
