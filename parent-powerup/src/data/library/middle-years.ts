import type { Challenge, Powerup } from '../../types';

/** About 5 to 15: homework, worries, friends, confidence, after-school meltdowns, puberty. */

export const challenges: Challenge[] = [
  {
    id: 'after-school-meltdowns',
    title: 'After-school meltdowns',
    emoji: '🎒',
    issues: ['feelings', 'school'],
    ages: { from: 4, to: 11 },
    peak: { from: 5, to: 8 },
    summary: 'Children often hold it together all day and let it all out at home, with the person they feel safest with.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'homework',
    title: 'Homework battles',
    emoji: '✏️',
    issues: ['school', 'behaviour'],
    ages: { from: 6, to: 14 },
    peak: { from: 7, to: 11 },
    summary: 'Tired brains, hard tasks and a parent who wants it done: homework is a common flashpoint through the primary years.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'friendships',
    title: 'Friendship troubles',
    emoji: '🤝',
    issues: ['friends', 'feelings'],
    ages: { from: 5, to: 14 },
    peak: { from: 7, to: 12 },
    summary: 'Falling out, being left out and shifting groups are part of how children learn about loyalty, fairness and themselves.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'worries',
    title: 'Worry & anxiety',
    emoji: '🫧',
    issues: ['anxiety'],
    ages: { from: 6, to: 18 },
    peak: { from: 8, to: 13 },
    summary: 'Worries grow more grown-up as children understand more of the world. Avoiding what they fear brings relief now, but makes the fear bigger.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'confidence',
    title: 'Low confidence & perfectionism',
    emoji: '⭐',
    issues: ['confidence', 'school'],
    ages: { from: 7, to: 16 },
    peak: { from: 9, to: 14 },
    summary: 'As children start comparing themselves to others, “I’m rubbish at this” and fear of mistakes can creep in.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'puberty',
    title: 'Puberty & body changes',
    emoji: '🧬',
    issues: ['body', 'connection'],
    ages: { from: 8, to: 15 },
    peak: { from: 10, to: 13 },
    summary: 'Puberty can start anywhere from about 8 to 13. Children cope best when they know what is coming before it arrives.',
    normal: '',
    seekHelp: [],
  },
];

export const powerups: Powerup[] = [];
