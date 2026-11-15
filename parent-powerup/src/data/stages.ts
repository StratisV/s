import type { Stage } from '../types';

/** The timeline's stages, youngest first. They meet end to end, 0 to 18. */
export const STAGES: Stage[] = [
  { id: 'baby', label: 'Baby', span: '0–1', from: 0, to: 1, blurb: 'Sleep, feeding and a whole new attachment.' },
  { id: 'toddler', label: 'Toddler', span: '1–3', from: 1, to: 3, blurb: 'Big feelings, small words, and "No!"' },
  { id: 'preschool', label: 'Preschool', span: '3–5', from: 3, to: 5, blurb: 'Imagination, fears and testing the rules.' },
  { id: 'early-school', label: 'Early school', span: '5–8', from: 5, to: 8, blurb: 'Starting school, friendships and fairness.' },
  { id: 'middle-years', label: 'Middle years', span: '8–12', from: 8, to: 12, blurb: 'Confidence, worries and the first of puberty.' },
  { id: 'teen', label: 'Teen', span: '12–18', from: 12, to: 18, blurb: 'Independence, identity and staying close.' },
];

/** The oldest age on the timeline. */
export const MAX_AGE = 18;
