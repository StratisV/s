import type { InterestId, KidColour, TemperamentId } from '../types';

export const KID_COLOURS: KidColour[] = ['sun', 'coral', 'mint', 'sky', 'lilac', 'rose'];

export const AVATARS = ['🦊', '🐻', '🐰', '🦁', '🐼', '🐨', '🐯', '🦄', '🐸', '🐙', '🦖', '🐳', '🦉', '🐝', '🌟', '🚀'];

export const TEMPERAMENTS: { id: TemperamentId; label: string; hint: string }[] = [
  { id: 'sensitive', label: 'Sensitive', hint: 'Feels things deeply; noise and change can be a lot' },
  { id: 'spirited', label: 'Spirited', hint: 'Full of energy, big reactions, always on the go' },
  { id: 'cautious', label: 'Cautious', hint: 'Watches first, warms up slowly to new things' },
  { id: 'easygoing', label: 'Easygoing', hint: 'Goes with the flow most days' },
  { id: 'strong-willed', label: 'Strong-willed', hint: 'Knows what they want, and says so' },
  { id: 'social', label: 'Social', hint: 'Loves people and being part of things' },
  { id: 'dreamy', label: 'Dreamy', hint: 'Lives in their imagination; transitions are hard' },
  { id: 'anxious', label: 'A worrier', hint: 'Often worries about what might happen' },
];

export const INTERESTS: { id: InterestId; label: string; emoji: string }[] = [
  { id: 'animals', label: 'Animals', emoji: '🐾' },
  { id: 'space', label: 'Space', emoji: '🪐' },
  { id: 'ocean', label: 'The sea', emoji: '🌊' },
  { id: 'dinosaurs', label: 'Dinosaurs', emoji: '🦕' },
  { id: 'nature', label: 'Nature', emoji: '🌳' },
  { id: 'sport', label: 'Sport', emoji: '⚽' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'art', label: 'Art', emoji: '🎨' },
  { id: 'building', label: 'Building', emoji: '🧱' },
  { id: 'stories', label: 'Stories', emoji: '📚' },
  { id: 'vehicles', label: 'Vehicles', emoji: '🚂' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
];
