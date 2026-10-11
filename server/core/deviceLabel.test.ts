import { describe, expect, it } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'iPhone · Safari',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
      'iPhone · Chrome',
    ],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15', 'iPhone · Firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/129.0 Mobile/15E148 Safari/605.1.15', 'iPhone · Edge'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'iPad · Safari'],
    // iPadOS asks for desktop sites as a Mac.
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Mac · Safari'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Android phone · Chrome'],
    ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36', 'Android tablet · Samsung Internet'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Windows PC · Edge'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Linux PC · Firefox'],
    // Headless Chrome (the e2e tests) says HeadlessChrome/ where Chrome says Chrome/.
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36', 'Linux PC · Chrome'],
    ['curl/8.5.0', 'Device · Browser'],
    ['', 'Device · Browser'],
    [undefined, 'Device · Browser'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it('is at most 60 characters', () => {
    expect(Array.from(deviceLabel('x'.repeat(10_000))).length).toBeLessThanOrEqual(60);
  });
});
