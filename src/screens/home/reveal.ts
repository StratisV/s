import { createContext } from 'react';

/**
 * The item Home is bringing into view after it was saved (HomeScreen's `revealItem`), for a
 * moment: a "Show N more" over it opens (ShowMore.tsx), the calendar goes to its day, and its
 * row lights up. Null the rest of the time.
 */
export const RevealContext = createContext<string | null>(null);
