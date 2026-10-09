// Where the sun is, so the Home scene can show the sky as it is outside.
// Low-precision solar position (NOAA / Astronomical Almanac approximation):
// good to about a minute for sunrise and sunset, which is plenty for a picture.

/** The household's house: 21 Alderbrook Road, London. */
export const LONDON = { lat: 51.5074, lon: -0.1278, timeZone: 'Europe/London' } as const;

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Sunrise/sunset are when the top of the sun touches the horizon (refraction included). */
const HORIZON = -0.833;

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** Sun elevation above the horizon and azimuth (from north, clockwise), in degrees. */
export function solarPosition(date: Date, lat: number, lon: number): { elevation: number; azimuth: number } {
  const n = date.getTime() / DAY_MS + 2440587.5 - 2451545.0; // days since J2000.0
  const L = norm360(280.46 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const gmstHours = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const hourAngle = (gmstHours * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
  const azimuth = norm360(
    Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle)) / RAD,
  );
  return { elevation, azimuth };
}

export interface SunTimes {
  /** Null when the sun doesn't rise or set that day (not the case in London). */
  sunrise: Date | null;
  solarNoon: Date;
  sunset: Date | null;
  /** Highest elevation that day, degrees. */
  maxElevation: number;
}

/** First crossing of `target` elevation between a and b (ms), by bisection. */
function crossing(a: number, b: number, lat: number, lon: number, target: number): number {
  let lo = a;
  let hi = b;
  const rising = solarPosition(new Date(lo), lat, lon).elevation < target;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const above = solarPosition(new Date(mid), lat, lon).elevation >= target;
    if (above === rising) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Sunrise, solar noon and sunset for the solar day around `date` (the 24
 * hours centred on the solar noon nearest to `date`).
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  // Solar noon is near 12:00 UTC shifted by longitude; refine to the elevation peak.
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let noon = utcMidnight + DAY_MS / 2 - (lon / 360) * DAY_MS;
  if (date.getTime() - noon > DAY_MS / 2) noon += DAY_MS;
  if (noon - date.getTime() > DAY_MS / 2) noon -= DAY_MS;
  // Golden-section search for the peak within ±1 hour.
  let lo = noon - 3_600_000;
  let hi = noon + 3_600_000;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (solarPosition(new Date(m1), lat, lon).elevation < solarPosition(new Date(m2), lat, lon).elevation) lo = m1;
    else hi = m2;
  }
  noon = (lo + hi) / 2;
  const maxElevation = solarPosition(new Date(noon), lat, lon).elevation;
  const minElevation = solarPosition(new Date(noon - DAY_MS / 2), lat, lon).elevation;
  const hasCrossings = maxElevation > HORIZON && minElevation < HORIZON;
  return {
    sunrise: hasCrossings ? new Date(crossing(noon - DAY_MS / 2, noon, lat, lon, HORIZON)) : null,
    solarNoon: new Date(noon),
    sunset: hasCrossings ? new Date(crossing(noon, noon + DAY_MS / 2, lat, lon, HORIZON)) : null,
    maxElevation,
  };
}

export type SkyPhase = 'night' | 'dawn' | 'sunrise' | 'day' | 'sunset' | 'dusk';

/**
 * The sky at `date`: night below −6° (civil twilight ends), dawn/dusk from
 * −6° to 0°, sunrise/sunset glow from 0° to 8°, day above. Morning vs evening
 * comes from whether we're before or after solar noon.
 */
export function skyPhase(elevation: number, beforeNoon: boolean): SkyPhase {
  if (elevation < -6) return 'night';
  if (elevation < 0) return beforeNoon ? 'dawn' : 'dusk';
  if (elevation < 8) return beforeNoon ? 'sunrise' : 'sunset';
  return 'day';
}

export interface SkyState {
  phase: SkyPhase;
  elevation: number;
  /** 0 at sunrise, 1 at sunset; outside 0..1 at night. */
  dayProgress: number;
  /** Elevation as a share of today's highest (1 at solar noon, negative below the horizon). */
  height: number;
}

/** Everything the scene needs to draw the sky for London at `date`. */
export function skyAt(date: Date, place: { lat: number; lon: number } = LONDON): SkyState {
  const { elevation } = solarPosition(date, place.lat, place.lon);
  const times = sunTimes(date, place.lat, place.lon);
  const beforeNoon = date.getTime() < times.solarNoon.getTime();
  const rise = times.sunrise?.getTime() ?? times.solarNoon.getTime() - DAY_MS / 4;
  const set = times.sunset?.getTime() ?? times.solarNoon.getTime() + DAY_MS / 4;
  return {
    phase: skyPhase(elevation, beforeNoon),
    elevation,
    dayProgress: (date.getTime() - rise) / (set - rise),
    height: elevation / Math.max(1, times.maxElevation),
  };
}
