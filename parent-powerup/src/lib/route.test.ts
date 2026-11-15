import { parseRoute, routeHash } from './route';

describe('route', () => {
  it('reads a tab and its params from the address', () => {
    expect(parseRoute('#/powerups?kid=abc&challenge=tantrums')).toEqual({ tab: 'powerups', kid: 'abc', challenge: 'tantrums' });
    expect(parseRoute('')).toEqual({ tab: 'meditate' });
    expect(parseRoute('#/nowhere')).toEqual({ tab: 'meditate' });
  });

  it('writes the same route back', () => {
    const route = { tab: 'powerups' as const, issue: 'sleep' as const, powerup: 'p1' };
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(routeHash({ tab: 'family' })).toBe('#/family');
  });
});
