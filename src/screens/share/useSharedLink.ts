import { useEffect, useRef } from 'react';
import { takeSharedLink } from '../../lib/sharedLink';
import { useHousehold } from '../../state/HomeProvider';

export const UNKNOWN_ITEM_TOAST = 'That item isn’t in your home';
export const UNKNOWN_AREA_TOAST = 'That area isn’t in your home';

interface SharedLinkHandlers {
  /** `?item=<id>`: open the Item sheet on it. */
  openItem(itemId: string): void;
  /** `?area=<id>`: show that area on Home, expanded. */
  showArea(areaId: string): void;
}

/**
 * Follows a shared link the app was opened with (lib/sharedLink.ts) once the household has
 * loaded: the item's sheet, or the area on Home. An item or area this household doesn't have
 * (another home's, or deleted since) only gets a short toast; a one-off item that has been
 * done says so.
 */
export function useSharedLink(handlers: SharedLinkHandlers): void {
  const home = useHousehold();
  const latest = useRef({ home, handlers });
  latest.current = { home, handlers };

  useEffect(() => {
    const link = takeSharedLink();
    if (!link) return;
    const { home, handlers } = latest.current;
    const { data, showToast } = home;
    if (link.kind === 'item') {
      if (data.items.some((it) => it.id === link.id)) handlers.openItem(link.id);
      else {
        const done = data.completions.find((c) => c.item_id === link.id);
        showToast(done ? `“${done.item_title}” is already done` : UNKNOWN_ITEM_TOAST);
      }
    } else if (data.areas.some((a) => a.id === link.id)) handlers.showArea(link.id);
    else showToast(UNKNOWN_AREA_TOAST);
  }, []);
}
