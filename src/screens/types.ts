export type Tab = 'home' | 'chat' | 'stats';

/** What the Item sheet is showing: an existing item, or a new one (area preselected). */
export type ItemSheetTarget = { kind: 'edit'; itemId: string } | { kind: 'new'; areaId?: string };
