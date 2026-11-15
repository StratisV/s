import type { Digest } from '../../types';
import { digest as w46 } from './2026-W46';
import { digest as w45 } from './2026-W45';
import { digest as w44 } from './2026-W44';

/**
 * The weekly digests, one file per ISO week ('2026-W46.ts'), each listed here. Newest first.
 * See README "Curating the weekly digest" for how a week is put together.
 */
const ALL: Digest[] = [w46, w45, w44];

export const DIGESTS: Digest[] = [...ALL].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
