// The local server: the built app and the API on one port, for `npm run dev:server` (API only,
// behind Vite's dev server) and the e2e-server suite (both). Bundled by
// `node scripts/build-server.mjs --local` into dist-server/local.mjs, then run with node.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Local server and tests".
//
// node dist-server/local.mjs [options]
//   --port <n>            default 4300
//   --static <dir>        serve this built app (GET of a file; anything else that accepts HTML
//                         gets index.html); without it, the API only
//   --data <dir>          FileBlobStore directory (default .homeos-local); --memory: MemoryBlobStore
//   --allow-reset         POST /__homeos/reset (header X-HomeOS: 1) wipes the store, the cache
//                         and the attempt limits; never in the Vercel bundle
//   --attempts <perIp>,<global>,<windowMs>   attempt limits (tests use small windows)
// Environment: HOMEOS_SETUP_CODE (as on Vercel), HOMEOS_BLOB_WRITES_PER_MONTH,
// HOMEOS_BLOB_READS_PER_MONTH. Cookies are not Secure (http://localhost); the IP is the socket's.
// Logs one line when listening: "home.os local server on http://localhost:<port>".
//
// SKELETON: not implemented yet.

throw new Error('server/entry/local.ts: not implemented yet');
