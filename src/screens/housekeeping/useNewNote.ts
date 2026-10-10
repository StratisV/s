import { useEffect, useState } from 'react';
import { timeOf } from '../../lib/logic/chat';
import { hasNewNote } from '../../lib/logic/housekeeping';
import type { ISOTimestamp } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';

/** Where this device keeps when a member last saw the message (the Housekeeping tab open). */
export const noteSeenKey = (memberId: string) => `homeos.housekeeping.seen.${memberId}`;

function loadSeen(memberId: string): ISOTimestamp | null {
  try {
    return localStorage.getItem(noteSeenKey(memberId));
  } catch {
    return null;
  }
}

function storeSeen(memberId: string, ts: ISOTimestamp) {
  try {
    localStorage.setItem(noteSeenKey(memberId), ts);
  } catch {
    /* storage unavailable: the dot only lasts for this session */
  }
}

/**
 * Whether the Housekeeping tab gets its dot: a message for the housekeeper written or
 * changed by someone else since this member last had the tab open on this device
 * (hasNewNote()), like Chat's unread dot. While the tab is open, the message on it counts
 * as seen.
 */
export function useNewNote(tabOpen: boolean): boolean {
  const { data, me } = useHousehold();
  const { note } = data.housekeeping;
  const [seen, setSeen] = useState(() => loadSeen(me.id));

  useEffect(() => {
    const at = note.updated_at;
    if (!tabOpen || !at || (seen && timeOf(seen) >= timeOf(at))) return;
    storeSeen(me.id, at);
    setSeen(at);
  }, [tabOpen, note.updated_at, me.id, seen]);

  // Seen in another tab of this person.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === noteSeenKey(me.id)) setSeen(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [me.id]);

  return !tabOpen && hasNewNote(note, me.id, seen);
}
