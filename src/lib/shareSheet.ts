import { copyText } from './clipboard';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * The system share sheet where there is one (iPhone, Android, some desktops), otherwise
 * `copy` goes on the clipboard. Closing the share sheet without sharing is 'cancelled'
 * (nothing else happens). Call it straight from the tap: Safari only opens the sheet
 * while the tap still counts.
 */
export async function shareOrCopy(data: ShareData, copy: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError (the tap no longer counts) and others: try the clipboard.
    }
  }
  return (await copyText(copy)) ? 'copied' : 'failed';
}
