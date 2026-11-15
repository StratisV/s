/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode single` inlines every asset (fonts, icons) so the build is one self-contained page,
// for sharing a preview without a server (README "Previews").
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: mode === 'single' ? { assetsInlineLimit: 100_000_000, cssCodeSplit: false, outDir: 'dist-single' } : {},
  server: { port: 5180, host: true },
  preview: { port: 4180, host: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
}));
