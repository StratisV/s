import type { Issue, IssueId } from '../types';

/** What the library filters by, in the order the chips show. */
export const ISSUES: Issue[] = [
  { id: 'sleep', label: 'Sleep', emoji: '🌙' },
  { id: 'feelings', label: 'Big feelings', emoji: '🌋' },
  { id: 'behaviour', label: 'Behaviour', emoji: '🧭' },
  { id: 'anxiety', label: 'Worries & fears', emoji: '🫧' },
  { id: 'eating', label: 'Eating', emoji: '🥦' },
  { id: 'siblings', label: 'Siblings', emoji: '🧸' },
  { id: 'screens', label: 'Screens', emoji: '📱' },
  { id: 'school', label: 'School', emoji: '🎒' },
  { id: 'friends', label: 'Friendships', emoji: '🤝' },
  { id: 'independence', label: 'Growing up', emoji: '🌱' },
  { id: 'confidence', label: 'Confidence', emoji: '⭐' },
  { id: 'body', label: 'Body & puberty', emoji: '🧬' },
  { id: 'connection', label: 'Staying close', emoji: '💬' },
  { id: 'risk', label: 'Risk & safety', emoji: '🛟' },
];

const BY_ID = new Map(ISSUES.map((issue) => [issue.id, issue]));

export function issue(id: IssueId): Issue {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown issue: ${id}`);
  return found;
}
