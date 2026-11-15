import type { Challenge, Powerup } from '../../types';

/** About 2 to 10: bedtime, listening, siblings, fears, fibs and screens. */

export const challenges: Challenge[] = [
  {
    id: 'bedtime-battles',
    title: 'Bedtime battles',
    emoji: '🛏️',
    issues: ['sleep', 'behaviour'],
    ages: { from: 2, to: 10 },
    peak: { from: 3, to: 6 },
    summary: 'One more story, one more drink: stalling at bedtime is common once children can climb out of bed and negotiate.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'not-listening',
    title: 'Not listening & “No!”',
    emoji: '🙉',
    issues: ['behaviour'],
    ages: { from: 2, to: 11 },
    peak: { from: 3, to: 7 },
    summary: 'Pushing back is how children practise independence. Most of the time they are absorbed, testing a limit or need a clearer instruction.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'sibling-rivalry',
    title: 'Sibling fights',
    emoji: '🧸',
    issues: ['siblings', 'feelings'],
    ages: { from: 2, to: 15 },
    peak: { from: 4, to: 10 },
    summary: 'Siblings compete for the same people and the same things. Conflict is normal, and it is also where children learn to negotiate.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'fears-nightmares',
    title: 'Fears & nightmares',
    emoji: '👻',
    issues: ['anxiety', 'sleep'],
    ages: { from: 2.5, to: 9 },
    peak: { from: 3, to: 6 },
    summary: 'As imagination blooms, so do monsters, the dark and bad dreams. Most of these fears are a normal part of growing up.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'lying',
    title: 'Lying & fibbing',
    emoji: '🤥',
    issues: ['behaviour'],
    ages: { from: 3, to: 13 },
    peak: { from: 4, to: 8 },
    summary: 'Early lies are a sign of a new thinking skill: knowing that others cannot see inside your head. How we respond shapes whether honesty feels safe.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'screen-time',
    title: 'Screen time battles',
    emoji: '📱',
    issues: ['screens', 'behaviour'],
    ages: { from: 2, to: 12 },
    peak: { from: 5, to: 10 },
    summary: 'Screens are designed to be hard to put down. The switch-off is often the hardest part for children, and for parents.',
    normal: '',
    seekHelp: [],
  },
];

export const powerups: Powerup[] = [];
