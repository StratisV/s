/** The tab bar at the foot of the screen, in this order: Home, Goals for the week, Housekeeping, Stats. */
export type Tab = 'home' | 'goals' | 'housekeeping' | 'stats';

/** What the Item sheet is showing: an existing item, or a new one (area preselected). */
export type ItemSheetTarget = { kind: 'edit'; itemId: string } | { kind: 'new'; areaId?: string };
