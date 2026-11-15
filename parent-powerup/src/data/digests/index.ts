import type { Digest } from '../../types';

/**
 * The weekly digests, one file per ISO week ('2026-W46.ts'), each listed here. Newest first.
 * See README "Curating the weekly digest" for how a week is put together.
 */
const ALL: Digest[] = [];

export const DIGESTS: Digest[] = [...ALL].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
