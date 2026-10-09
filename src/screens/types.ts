/** The tab switch under the hero, in this order: Home, Chat, Housekeeping, Stats. */
export type Tab = 'home' | 'chat' | 'housekeeping' | 'stats';

/** What the Item sheet is showing: an existing item, or a new one (area preselected). */
export type ItemSheetTarget = { kind: 'edit'; itemId: string } | { kind: 'new'; areaId?: string };
