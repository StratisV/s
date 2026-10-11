/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_BASE?: string;
  readonly VITE_FORCE_DEMO?: string;
  /**
   * '1' when the build has this deployment's own server (server mode): set by vite.config.ts
   * from the presence of BLOB_READ_WRITE_TOKEN (or HOMEOS_LOCAL_SERVER=1 for local builds),
   * never from its value. src/lib/backend/index.ts picks the backend.
   */
  readonly VITE_HOMEOS_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
