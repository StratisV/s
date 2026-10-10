import { execFileSync } from 'node:child_process';

/** The local Supabase stack the live e2e tests run against. */
export interface LiveEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_KEY (the names the live
 * Vitest suite uses), or else what `npx supabase status -o env` says about the local stack.
 * The keys are never printed. Only a local stack is accepted (the tests create and delete
 * accounts), unless LIVE_E2E_ALLOW_REMOTE=1.
 *
 * The values are written back to process.env, so the test workers inherit them instead of
 * asking the Supabase CLI again.
 */
export function liveEnv(): LiveEnv {
  let url = process.env.SUPABASE_TEST_URL ?? '';
  let anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? '';
  let serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';
  if (!url || !anonKey || !serviceKey) {
    const status = supabaseStatus();
    url ||= status.API_URL ?? '';
    anonKey ||= status.ANON_KEY ?? '';
    serviceKey ||= status.SERVICE_ROLE_KEY ?? '';
  }
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'The live e2e tests need a local Supabase stack: run `npx supabase start` (and apply the migrations), ' +
        'or set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_KEY.',
    );
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.LIVE_E2E_ALLOW_REMOTE !== '1') {
    throw new Error(
      `The live e2e tests create and delete accounts, so they only run against a local stack (not ${host}). ` +
        'Set LIVE_E2E_ALLOW_REMOTE=1 to run them against a disposable remote project.',
    );
  }
  process.env.SUPABASE_TEST_URL = url;
  process.env.SUPABASE_TEST_ANON_KEY = anonKey;
  process.env.SUPABASE_TEST_SERVICE_KEY = serviceKey;
  return { url, anonKey, serviceKey };
}

/** `npx supabase status -o env` as a map ({} when the CLI or the stack is not there). */
function supabaseStatus(): Record<string, string> {
  try {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    });
    const vars: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch {
    return {};
  }
}
