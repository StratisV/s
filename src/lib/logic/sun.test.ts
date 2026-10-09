import { LONDON, skyAt, skyPhase, solarPosition, sunTimes } from './sun';

const { lat, lon } = LONDON;

/** Minutes between two instants. */
const diffMin = (a: Date | null, iso: string) => Math.abs((a!.getTime() - new Date(iso).getTime()) / 60_000);

describe('sunTimes for London (reference times from published almanac tables)', () => {
  it('spring equinox: sunrise 06:03 GMT, sunset 18:13 GMT', () => {
    const t = sunTimes(new Date('2026-03-20T12:00:00Z'), lat, lon);
    expect(diffMin(t.sunrise, '2026-03-20T06:03:00Z')).toBeLessThan(4);
    expect(diffMin(t.sunset, '2026-03-20T18:13:00Z')).toBeLessThan(4);
  });

  it('summer solstice: sunrise 04:43 BST, sunset 21:21 BST', () => {
    const t = sunTimes(new Date('2026-06-21T12:00:00Z'), lat, lon);
    expect(diffMin(t.sunrise, '2026-06-21T03:43:00Z')).toBeLessThan(4);
    expect(diffMin(t.sunset, '2026-06-21T20:21:00Z')).toBeLessThan(4);
    expect(t.maxElevation).toBeGreaterThan(61);
    expect(t.maxElevation).toBeLessThan(63);
  });

  it('winter solstice: sunrise 08:04 GMT, sunset 15:53 GMT', () => {
    const t = sunTimes(new Date('2026-12-21T12:00:00Z'), lat, lon);
    expect(diffMin(t.sunrise, '2026-12-21T08:04:00Z')).toBeLessThan(4);
    expect(diffMin(t.sunset, '2026-12-21T15:53:00Z')).toBeLessThan(4);
    expect(t.maxElevation).toBeGreaterThan(14);
    expect(t.maxElevation).toBeLessThan(16);
  });

  it('8 October: sunrise about 07:12 BST, sunset about 18:22 BST, noon about 12:48 BST', () => {
    const t = sunTimes(new Date('2026-10-08T09:00:00Z'), lat, lon);
    expect(diffMin(t.sunrise, '2026-10-08T06:12:00Z')).toBeLessThan(4);
    expect(diffMin(t.sunset, '2026-10-08T17:22:00Z')).toBeLessThan(4);
    expect(diffMin(t.solarNoon, '2026-10-08T11:48:00Z')).toBeLessThan(3);
  });

  it('uses the solar day around the given instant, also late in the evening', () => {
    const t = sunTimes(new Date('2026-10-08T22:30:00Z'), lat, lon);
    expect(t.solarNoon.toISOString().slice(0, 10)).toBe('2026-10-08');
  });
});

describe('solarPosition', () => {
  it('is above the horizon at London noon and below at midnight', () => {
    expect(solarPosition(new Date('2026-10-08T11:48:00Z'), lat, lon).elevation).toBeGreaterThan(25);
    expect(solarPosition(new Date('2026-10-08T23:48:00Z'), lat, lon).elevation).toBeLessThan(-20);
  });

  it('rises in the east and sets in the west', () => {
    expect(solarPosition(new Date('2026-10-08T06:30:00Z'), lat, lon).azimuth).toBeGreaterThan(80);
    expect(solarPosition(new Date('2026-10-08T06:30:00Z'), lat, lon).azimuth).toBeLessThan(120);
    expect(solarPosition(new Date('2026-10-08T17:15:00Z'), lat, lon).azimuth).toBeGreaterThan(240);
    expect(solarPosition(new Date('2026-10-08T17:15:00Z'), lat, lon).azimuth).toBeLessThan(280);
  });
});

describe('skyPhase / skyAt', () => {
  it('classifies by elevation and morning/evening', () => {
    expect(skyPhase(-12, true)).toBe('night');
    expect(skyPhase(-3, true)).toBe('dawn');
    expect(skyPhase(-3, false)).toBe('dusk');
    expect(skyPhase(4, true)).toBe('sunrise');
    expect(skyPhase(4, false)).toBe('sunset');
    expect(skyPhase(30, false)).toBe('day');
  });

  it('gives the expected London sky through 8 October', () => {
    const at = (hhmmBST: string) => skyAt(new Date(`2026-10-08T${hhmmBST}:00+01:00`)).phase;
    expect(at('03:00')).toBe('night');
    expect(at('06:55')).toBe('dawn');
    expect(at('07:30')).toBe('sunrise');
    expect(at('12:00')).toBe('day');
    expect(at('18:05')).toBe('sunset');
    expect(at('18:45')).toBe('dusk');
    expect(at('22:00')).toBe('night');
  });

  it('dayProgress runs 0 to 1 from sunrise to sunset and height peaks at noon', () => {
    const noon = skyAt(new Date('2026-10-08T11:48:00Z'));
    expect(noon.dayProgress).toBeGreaterThan(0.45);
    expect(noon.dayProgress).toBeLessThan(0.55);
    expect(noon.height).toBeGreaterThan(0.98);
    const night = skyAt(new Date('2026-10-08T23:00:00Z'));
    expect(night.dayProgress).toBeGreaterThan(1);
    expect(night.height).toBeLessThan(0);
  });
});
