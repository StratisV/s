import { useEffect, useState } from 'react';
import { dateKey } from '../../lib/dates';

/**
 * Today's date key, kept current: it moves on at midnight, and when the app comes back to the
 * front after a night in the background.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => dateKey());

  useEffect(() => {
    const check = () => setToday(dateKey());
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    const timer = setTimeout(check, midnight.getTime() - now.getTime());
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [today]);

  return today;
}
