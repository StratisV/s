import type { Challenge, Powerup } from '../../types';

/** About 10 to 18: talking, phones, risk, sleep, exams and moods. */

export const challenges: Challenge[] = [
  {
    id: 'teen-communication',
    title: 'Teen shutting you out',
    emoji: '💬',
    issues: ['connection'],
    ages: { from: 11, to: 18 },
    peak: { from: 13, to: 16 },
    summary: 'Pulling away is part of building an identity. Teens still need their parents a great deal; they just want it on their own terms.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'social-media',
    title: 'Phones & social media',
    emoji: '📲',
    issues: ['screens', 'friends', 'risk'],
    ages: { from: 10, to: 18 },
    peak: { from: 12, to: 16 },
    summary: 'Phones are where teens’ friendships now live. The aim is a healthy relationship with them, not a war over them.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'teen-moods',
    title: 'Moods & irritability',
    emoji: '🌦️',
    issues: ['feelings', 'connection'],
    ages: { from: 11, to: 18 },
    peak: { from: 12, to: 15 },
    summary: 'Hormones, a brain under construction and a busy social world make for quick changes of mood in early adolescence.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'teen-sleep',
    title: 'Teen sleep & late nights',
    emoji: '😴',
    issues: ['sleep', 'screens'],
    ages: { from: 12, to: 18 },
    peak: { from: 14, to: 17 },
    summary: 'Teenage body clocks really do shift later, while school still starts early. Many teens are short of sleep.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'risk-taking',
    title: 'Risk-taking',
    emoji: '🛟',
    issues: ['risk', 'connection'],
    ages: { from: 12, to: 18 },
    peak: { from: 14, to: 17 },
    summary: 'The teenage brain is tuned for reward and peers, years before its brakes are fully built. Alcohol, vaping and online risks peak here.',
    normal: '',
    seekHelp: [],
  },
  {
    id: 'exam-stress',
    title: 'Exam stress & pressure',
    emoji: '📚',
    issues: ['school', 'anxiety'],
    ages: { from: 12, to: 18 },
    peak: { from: 15, to: 18 },
    summary: 'Some pressure helps performance; too much harms it. Exam years can tip many teens into the too-much zone.',
    normal: '',
    seekHelp: [],
  },
];

export const powerups: Powerup[] = [];
