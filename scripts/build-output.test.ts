import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOutputConfig, functionConfig, sourceToRegex } from './build-output.mjs';
import { backendMode, supabaseSettings } from './backend-mode.mjs';

describe('buildOutputConfig', () => {
  it("carries vercel.json's headers over in order, then the filesystem", () => {
    const vercelJson = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const config = buildOutputConfig(vercelJson);
    expect(config.version).toBe(3);
    expect(config.routes.at(-1)).toEqual({ handle: 'filesystem' });
    expect(config.routes.slice(0, -1)).toHaveLength(vercelJson.headers.length);
    const sw = config.routes[0];
    expect(sw).toEqual({ src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true });
    const all = config.routes.find((r) => r.src === '^/(.*)$');
    expect(all?.headers).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
  });

  it("carries vercel.json's cron over: the morning notifications run, once a day (all Hobby allows)", () => {
    const vercelJson = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(vercelJson.crons).toEqual([{ path: '/api/home?op=tick', schedule: '0 7 * * *' }]);
    expect(buildOutputConfig(vercelJson).crons).toEqual(vercelJson.crons);
    // Once a day: a fixed minute and hour, every day.
    const [minute, hour, ...rest] = vercelJson.crons[0].schedule.split(' ');
    expect([/^\d+$/.test(minute), /^\d+$/.test(hour), rest]).toEqual([true, true, ['*', '*', '*']]);
    expect(buildOutputConfig({ headers: [] })).toEqual({ version: 3, routes: [{ handle: 'filesystem' }] });
    expect(() => buildOutputConfig({ crons: [{ path: 'api/home', schedule: '0 7 * * *' }] })).toThrow();
    expect(() => buildOutputConfig({ crons: [{ path: '/api/home', schedule: 'daily' }] })).toThrow();
  });

  it('turns sources into anchored regular expressions', () => {
    expect(sourceToRegex('/assets/(.*)')).toBe('^/assets/(.*)$');
    expect(sourceToRegex('/manifest.webmanifest')).toBe('^/manifest\\.webmanifest$');
    expect(new RegExp(sourceToRegex('/assets/(.*)')).test('/assets/index-abc.js')).toBe(true);
    expect(new RegExp(sourceToRegex('/sw.js')).test('/swxjs')).toBe(false);
  });

  it('refuses sources it cannot carry over', () => {
    expect(() => sourceToRegex('/items/:id')).toThrow();
    expect(() => sourceToRegex('/(a|b)')).toThrow();
    expect(() => sourceToRegex('assets')).toThrow();
  });

  it('configures the function for the Node launcher, pinned to a region only when asked', () => {
    expect(functionConfig()).toEqual({
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 15,
    });
    expect(functionConfig({ region: 'lhr1' }).regions).toEqual(['lhr1']);
  });
});

describe('backendMode', () => {
  const supabase = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };

  it('is demo when forced, whatever else is set', () => {
    expect(backendMode({ VITE_FORCE_DEMO: '1', BLOB_READ_WRITE_TOKEN: 't', ...supabase })).toBe('demo');
  });
  it('prefers Supabase when it is configured', () => {
    expect(backendMode({ BLOB_READ_WRITE_TOKEN: 't', ...supabase })).toBe('supabase');
    expect(supabaseSettings(supabase)).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon' });
  });
  it('is the server when the deployment has a Blob store, or a local build asks for it', () => {
    expect(backendMode({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })).toBe('server');
    expect(backendMode({ HOMEOS_LOCAL_SERVER: '1' })).toBe('server');
  });
  it('is demo otherwise', () => {
    expect(backendMode({})).toBe('demo');
    expect(backendMode({ BLOB_READ_WRITE_TOKEN: '' })).toBe('demo');
    expect(backendMode({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })).toBe('demo');
  });
});
