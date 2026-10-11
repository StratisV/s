export type BuildBackendMode = 'demo' | 'supabase' | 'server';
export type BuildEnv = Record<string, string | undefined>;
export declare function supabaseSettings(env: BuildEnv): { url: string; anonKey: string };
export declare function backendMode(env: BuildEnv): BuildBackendMode;
