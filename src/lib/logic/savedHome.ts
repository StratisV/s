import saved from './savedHome.json';

/**
 * The household's home as it was on Stratis's phone (11 Oct 2026): 11 areas, 21 items, Stratis
 * and Shea (not joined yet), the starter housekeeping list. A homeos.demo.v1 document built with
 * the app's own DemoBackend by scripts/build-saved-home.ts. Server mode's setup can bring it
 * online when the phone's own copy is not on this device ("Use my saved copy"); the phone's copy
 * is better when there is one (it has every detail).
 */
export const SAVED_HOME_DOC: string = JSON.stringify(saved);
