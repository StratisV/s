import type { Meditation } from '../types';

/**
 * The guided meditations. Together ones are for a parent and child side by side, written for
 * the child to hear; solo ones are for the parent alone. Each step's seconds add up to the
 * session's length.
 */
export const MEDITATIONS: Meditation[] = [
  {
    id: 'balloon-belly',
    title: 'Balloon Belly',
    mode: 'together',
    ages: { from: 3, to: 7 },
    emoji: '🎈',
    theme: 'Balloons',
    interests: ['art', 'stories'],
    goodFor: ['feelings', 'sleep'],
    intro: 'Fill your tummies up like balloons, and let them float back down.',
    steps: [
      { text: 'Sit or lie down next to each other. Put one hand on your tummy.', seconds: 15 },
      { text: 'Imagine there is a balloon in your tummy. What colour is yours?', seconds: 15 },
      { text: 'Breathe in through your nose and fill your balloon up… and let it go slowly.', seconds: 40, breath: { inhale: 4, exhale: 5 } },
      { text: 'Watch each other’s hands go up and down, up and down.', seconds: 30, breath: { inhale: 4, exhale: 5 } },
      { text: 'Now let your breathing go back to normal. How does your body feel?', seconds: 20 },
    ],
  },
  {
    id: 'reset-after-a-hard-moment',
    title: 'Reset after a hard moment',
    mode: 'solo',
    emoji: '🌿',
    theme: 'Calm after a hard moment',
    interests: [],
    goodFor: ['feelings'],
    intro: 'Two minutes to let the stress settle before you go back in.',
    steps: [
      { text: 'Find somewhere to stand or sit for a moment. You do not have to fix anything right now.', seconds: 15 },
      { text: 'Breathe in for four, and out for six. A longer out-breath tells your body it is safe.', seconds: 60, breath: { inhale: 4, exhale: 6 } },
      { text: 'Notice where you feel it: jaw, shoulders, chest. Let that place soften a little.', seconds: 25 },
      { text: 'Say to yourself: “This is hard, and I am doing my best. Repair is always possible.”', seconds: 20 },
    ],
  },
];
