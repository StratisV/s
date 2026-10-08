/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE || '/',
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
