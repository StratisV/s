import { useCallback, useRef } from 'react';
import type { ShareMessage } from '../../lib/logic/share';
import { shareOrCopy } from '../../lib/shareSheet';
import { useHome } from '../../state/HomeProvider';

export const COPIED_TOAST = 'Copied to share';
export const SHARE_FAILED_TOAST = 'Couldn’t share. Try again.';

/**
 * A second tap while the share sheet is coming up is ignored (it would only fail with
 * InvalidStateError, then copy). Once the sheet is up it covers the page, so after this long
 * Share works again even if a share sheet never reports back.
 */
const SHARE_GUARD_MS = 1500;

/**
 * Shares a message (an item or an area) with the system share sheet, or copies it where there
 * is none and says so. Cancelling the share sheet does nothing. Call it straight from the tap.
 */
export function useShare(): (message: ShareMessage) => void {
  const { showToast } = useHome();
  const busy = useRef(0);
  const seq = useRef(0);
  return useCallback(
    (message: ShareMessage) => {
      if (busy.current) return;
      const token = ++seq.current;
      busy.current = token;
      const release = () => {
        if (busy.current === token) busy.current = 0;
      };
      const guard = setTimeout(release, SHARE_GUARD_MS);
      // The text carries the link (its last line), so every app gets both, and Copy in the
      // share sheet copies the whole message rather than only the link.
      void shareOrCopy({ title: message.title, text: message.text }, message.text)
        .then((outcome) => {
          if (outcome === 'copied') showToast(COPIED_TOAST);
          else if (outcome === 'failed') showToast(SHARE_FAILED_TOAST);
        })
        .finally(() => {
          clearTimeout(guard);
          release();
        });
    },
    [showToast],
  );
}
