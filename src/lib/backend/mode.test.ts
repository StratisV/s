import { describe, expect, it } from 'vitest';
import { pickBackendMode } from './index';

describe('pickBackendMode', () => {
  const supabase = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'anon' };

  it('forced demo first, then Supabase, then the server, else demo', () => {
    expect(pickBackendMode({ forceDemo: '1', server: '1', ...supabase })).toBe('demo');
    expect(pickBackendMode({ server: '1', ...supabase })).toBe('supabase');
    expect(pickBackendMode({ server: '1' })).toBe('server');
    expect(pickBackendMode({ server: '' })).toBe('demo');
    expect(pickBackendMode({ supabaseUrl: 'https://x.supabase.co' })).toBe('demo');
  });
});
