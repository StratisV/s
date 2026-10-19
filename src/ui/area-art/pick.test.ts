import { describe, expect, it } from 'vitest';
import { DEFAULT_AREAS } from '../../lib/constants';
import { backdrop, COLOURWAYS, hashSeed, isAlt, pickArt, sceneKind, type SceneKind } from './pick';

describe('sceneKind', () => {
  it("gives each of the household's 11 areas its own scene", () => {
    const kinds = Object.fromEntries(DEFAULT_AREAS.map((name) => [name, `${sceneKind(name)}${isAlt(name) ? '-alt' : ''}`]));
    expect(kinds).toEqual({
      Kitchen: 'kitchen',
      'Living Room': 'living',
      'Bathroom Small': 'bathroom-alt',
      'Bathroom Large': 'bathroom',
      'Bedroom Small': 'bedroom-alt',
      'Bedroom Large': 'bedroom',
      Garden: 'garden',
      'Garden Lounge': 'gardenRoom',
      Jacuzzi: 'hotTub',
      Hallway: 'hallway',
      'Front garden': 'frontGarden',
    });
    expect(new Set(Object.values(kinds)).size).toBe(11);
  });

  const CASES: [SceneKind, string[]][] = [
    ['kitchen', ['kitchen', 'KITCHEN', 'Kitchenette', 'Pantry', 'Larder', 'Galley']],
    ['living', ['Lounge', 'Sitting room', 'Front room', 'Family room', 'Den', 'Snug', 'Drawing room', 'TV room', 'Parlor']],
    ['bathroom', ['Bathroom', 'Shower room', 'En-suite', 'Ensuite', 'Toilet', 'WC', 'Loo', 'Cloakroom', 'Restroom', 'Powder room', 'Guest bathroom']],
    ['bedroom', ['Bedroom', 'Master', 'Guest room', 'Spare room', 'Box room', 'Bedroom 2']],
    ['hallway', ['Hall', 'Entrance', 'Entryway', 'Foyer', 'Corridor', 'Vestibule']],
    ['garden', ['Back garden', 'Yard', 'Backyard', 'Lawn', 'Allotment', 'Flower bed', 'Veg patch']],
    ['frontGarden', ['Front yard', 'Front lawn', 'Driveway', 'Drive', 'Porch', 'Bins']],
    ['gardenRoom', ['Garden room', 'Summer house', 'Summerhouse', 'Conservatory', 'Orangery', 'Sunroom', 'Greenhouse']],
    ['hotTub', ['Hot tub', 'Hottub', 'Spa', 'Pool', 'Swimming pool']],
    ['utility', ['Utility room', 'Laundry', 'Laundry room', 'Mudroom', 'Boot room', 'Boiler cupboard']],
    ['office', ['Office', 'Home office', 'Study', 'Studio', 'Library']],
    ['dining', ['Dining room', 'Dining', 'Breakfast room']],
    ['garage', ['Garage', 'Carport', 'Shed', 'Garden shed', 'Workshop']],
    ['stairs', ['Stairs', 'Staircase', 'Landing', 'Stairwell']],
    ['loft', ['Loft', 'Attic', 'Eaves']],
    ['balcony', ['Balcony', 'Terrace', 'Roof terrace', 'Patio', 'Deck', 'Veranda']],
    ['nursery', ['Nursery', 'Kids room', "Kids' room", "Children's room", 'Playroom', 'Games room']],
    ['room', ['Gym', 'Wine cellar', 'Music room', 'Upstairs', '', '   ']],
  ];
  it.each(CASES)('%s', (kind, names) => {
    for (const name of names) expect([name, sceneKind(name)]).toEqual([name, kind]);
  });
});

describe('isAlt', () => {
  it('picks the other composition from size words', () => {
    for (const name of ['Bathroom Small', 'Guest bedroom', 'Downstairs loo', 'Spare room', 'Single bedroom', 'Box room', 'Bedroom 2', 'Shower room', 'En suite']) {
      expect([name, isAlt(name)]).toEqual([name, true]);
    }
    for (const name of ['Bathroom Large', 'Master bedroom', 'Upstairs bathroom', 'Main bathroom', 'Family bathroom', 'Bathroom', 'Bedroom 1', 'Kitchen']) {
      expect([name, isAlt(name)]).toEqual([name, false]);
    }
  });

  it('lets the bigger words win', () => {
    expect(isAlt('Large guest bedroom')).toBe(false);
  });
});

describe('pickArt', () => {
  it('is the same every time for the same name and seed', () => {
    expect(pickArt('Kitchen', 'a-kitchen')).toEqual(pickArt('Kitchen', 'a-kitchen'));
    expect(hashSeed('a-kitchen')).toBe(hashSeed('a-kitchen'));
  });

  it('spreads seeds over every colourway', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => pickArt('Kitchen', `area-${i}`).colourway.name));
    expect(used.size).toBe(COLOURWAYS.length);
  });

  it('gives two areas of the same kind different pictures for different seeds', () => {
    const keys = new Set(Array.from({ length: 12 }, (_, i) => pickArt('Bedroom', `00000000-0000-4000-8000-00000000000${i}`).key));
    expect(keys.size).toBeGreaterThan(8);
  });

  it("gives the household's 11 areas 11 different pictures whatever their seeds", () => {
    for (let round = 0; round < 20; round++) {
      const keys = DEFAULT_AREAS.map((name, i) => pickArt(name, `seed-${round}-${i}`).key.split(':')[0]);
      expect(new Set(keys).size).toBe(11);
    }
  });

  it('has a placeholder gradient in the scene colours, by day and in the evening', () => {
    const pick = pickArt('Kitchen', 'a');
    expect(backdrop(pick, false)).toContain(pick.colourway.wall);
    expect(backdrop(pick, true)).toMatch(/^linear-gradient/);
    expect(backdrop(pick, true)).not.toContain(pick.colourway.wall);
    expect(backdrop(pickArt('Garden', 'a'), false)).toContain(pickArt('Garden', 'a').colourway.skyTop);
  });
});
