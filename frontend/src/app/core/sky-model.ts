import { DayTimes, PrayerLocation, solarAltitude } from './prayer-calc';

export interface SkyState {
  altitude: number;
  phase: string;
  top: string;
  mid: string;
  bottom: string;
  ground: string;
  sunColor: string;
  starOpacity: number;
  /** 0 at sunrise, 1 at sunset; outside that range the sun is below the horizon. */
  sunProgress: number;
  /**
   * Rotation of the sun–moon wheel in degrees. 0–180 is day (sun above the horizon),
   * 180–360 is night (moon above). The moon always sits opposite the sun.
   */
  wheel: number;
  /** Lunar phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  moonPhase: number;
  /** Fraction of the moon's disc that is lit (0–1). */
  moonIllumination: number;
  /** 1 when the sun rules the sky, 0 when the moon does. */
  daylight: number;
  theme: {
    accent: string;
    accentInk: string;
    glass: string;
    glassBorder: string;
  };
}

type Rgb = [number, number, number];
type Stop = [altitude: number, top: string, mid: string, bottom: string];

const NIGHT: Stop = [-90, '#03050f', '#070b22', '#0d1233'];

// Sky colours keyed by sun altitude. Dawn leans cool rose; dusk leans ember.
const MORNING: Stop[] = [
  NIGHT,
  [-18, '#050818', '#0b1130', '#151b44'],
  [-12, '#0a1236', '#1d2860', '#3b3f7e'],
  [-6, '#1a2a66', '#56508f', '#d98aa0'],
  [0, '#35549f', '#b98bb4', '#ffb27a'],
  [6, '#4a86cf', '#95bfe6', '#ffd8a0'],
  [15, '#3a80d4', '#7ab3e9', '#cfe7fa'],
  [90, '#2566c2', '#62a2e4', '#bcdcf8'],
];

const EVENING: Stop[] = [
  NIGHT,
  [-18, '#050818', '#0b1130', '#151b44'],
  [-12, '#0b1136', '#261f58', '#472a66'],
  [-6, '#1c2360', '#653d86', '#cc5a6a'],
  [0, '#394d96', '#d06a7a', '#ff8a4c'],
  [6, '#4777bf', '#e2a877', '#ffbe6e'],
  [15, '#3a80d4', '#7ab3e9', '#d6e8f6'],
  [90, '#2566c2', '#62a2e4', '#bcdcf8'],
];

/** Moonlit night tint, blended in proportionally to the moon's illumination. */
const MOONLIGHT: Rgb[] = [hex('#0e1a44'), hex('#1b2c66'), hex('#2d3f80')];

const SYNODIC_MONTH = 29.530588853;
const REFERENCE_NEW_MOON_JD = 2451550.1; // 2000-01-06 18:14 UTC

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

const css = ([r, g, b]: Rgb, alpha = 1) => (alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`);

function paletteAt(stops: Stop[], alt: number): Rgb[] {
  let i = 0;
  while (i < stops.length - 2 && alt > stops[i + 1][0]) i++;
  const [a0, ...from] = stops[i];
  const [a1, ...to] = stops[i + 1];
  const t = clamp((alt - a0) / (a1 - a0));
  return from.map((c, k) => mix(hex(c), hex(to[k]), t));
}

function phaseName(alt: number, rising: boolean, nearNoon: boolean): string {
  if (alt < -18) return 'Night';
  if (alt < -6) return rising ? 'Dawn' : 'Dusk';
  if (alt < 2) return rising ? 'Sunrise' : 'Sunset';
  if (nearNoon) return 'Midday';
  if (alt < 12) return rising ? 'Morning' : 'Golden hour';
  return rising ? 'Morning' : 'Afternoon';
}

export function moonPhaseAt(when: Date): number {
  const jd = when.getTime() / 86_400_000 + 2440587.5;
  const p = (jd - REFERENCE_NEW_MOON_JD) / SYNODIC_MONTH;
  return p - Math.floor(p);
}

export function skyState(
  now: Date,
  loc: PrayerLocation,
  yesterday: DayTimes,
  today: DayTimes,
  tomorrow: DayTimes,
): SkyState {
  const t = now.getTime();
  const alt = solarAltitude(now, loc);
  const rising = t < today.dhuhr.getTime();
  const nearNoon = Math.abs(t - today.dhuhr.getTime()) < 45 * 60_000;

  const sunrise = today.sunrise.getTime();
  const sunset = today.maghrib.getTime();
  const sunProgress = (t - sunrise) / (sunset - sunrise);

  let wheel: number;
  if (t < sunrise) {
    const prevSunset = yesterday.maghrib.getTime();
    wheel = 180 + (180 * (t - prevSunset)) / (sunrise - prevSunset);
  } else if (t <= sunset) {
    wheel = 180 * sunProgress;
  } else {
    const nextSunrise = tomorrow.sunrise.getTime();
    wheel = 180 + (180 * (t - sunset)) / (nextSunrise - sunset);
  }

  const moonPhase = moonPhaseAt(now);
  const moonIllumination = (1 - Math.cos(2 * Math.PI * moonPhase)) / 2;

  // A bright moon lifts the night sky toward blue and washes out faint stars.
  const nightness = clamp((-alt - 8) / 10);
  const moonGlow = nightness * moonIllumination * 0.45;
  const [top, mid, bottom] = paletteAt(rising ? MORNING : EVENING, alt).map((c, i) => mix(c, MOONLIGHT[i], moonGlow));

  // Theme: gold from the sun by day, silver-blue from the moon by night.
  const daylight = clamp((alt + 8) / 10);
  const sunAccent = mix(hex('#ff9a5a'), hex('#ffd98a'), clamp(alt / 20));
  const moonAccent = mix(hex('#9fb3e8'), hex('#dfe8ff'), moonIllumination);
  const accent = mix(moonAccent, sunAccent, daylight);
  const glassTint = mix(hex('#060a1e'), hex('#14264a'), daylight);

  return {
    altitude: alt,
    phase: phaseName(alt, rising, nearNoon),
    top: css(top),
    mid: css(mid),
    bottom: css(bottom),
    ground: css(mix(hex('#04060f'), hex('#142039'), clamp((alt + 12) / 30))),
    sunColor: css(mix(hex('#ff5a2a'), hex('#fff4cf'), clamp(alt / 25))),
    starOpacity: clamp((-alt - 3) / 12) * (1 - 0.55 * moonIllumination),
    sunProgress,
    wheel,
    moonPhase,
    moonIllumination,
    daylight,
    theme: {
      accent: css(accent),
      accentInk: css(mix(accent, hex('#1a1206'), 0.82)),
      glass: css(glassTint, 0.22 + 0.2 * (1 - daylight)),
      glassBorder: css(accent, 0.18 + 0.1 * (1 - daylight)),
    },
  };
}
