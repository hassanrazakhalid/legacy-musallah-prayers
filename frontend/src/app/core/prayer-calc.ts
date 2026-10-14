/**
 * Astronomical prayer-time calculation, adapted from the PrayTimes.org algorithm.
 * Runs entirely client-side so the sky animation and the timetable share one source of truth.
 */
import type { Ymd } from './zoned-time';

export interface PrayerLocation {
  name: string;
  region: string;
  lat: number;
  lng: number;
  timeZone: string;
}

export interface CalcMethod {
  name: string;
  fajrAngle: number;
  ishaAngle: number;
  /** 1 = Standard (Shafi'i, Maliki, Hanbali), 2 = Hanafi */
  asrFactor: 1 | 2;
}

export interface DayTimes {
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
}

export const CALGARY: PrayerLocation = {
  name: 'Calgary',
  region: 'AB',
  lat: 51.0447,
  lng: -114.0719,
  timeZone: 'America/Edmonton',
};

export const ISNA: CalcMethod = { name: 'ISNA', fajrAngle: 15, ishaAngle: 15, asrFactor: 1 };

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const sin = (d: number) => Math.sin(rad(d));
const cos = (d: number) => Math.cos(rad(d));
const tan = (d: number) => Math.tan(rad(d));
const asin = (x: number) => deg(Math.asin(x));
const acos = (x: number) => deg(Math.acos(x));
const atan2 = (y: number, x: number) => deg(Math.atan2(y, x));
const acot = (x: number) => deg(Math.atan(1 / x));
const fix = (a: number, b: number) => ((a % b) + b) % b;

function julian(y: number, m: number, d: number): number {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

/** Sun declination (deg) and equation of time (hours, in [-12, 12)) for a Julian date. */
function sunPosition(jd: number) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const ra = fix(atan2(cos(e) * sin(L), cos(L)) / 15, 24);
  const eqt = fix(q / 15 - ra + 12, 24) - 12;
  const decl = asin(sin(e) * sin(L));
  return { decl, eqt };
}

export function computeDay(ymd: Ymd, loc: PrayerLocation, method: CalcMethod = ISNA): DayTimes {
  const jDate = julian(ymd.y, ymd.m, ymd.d) - loc.lng / (15 * 24);

  const midDay = (t: number) => fix(12 - sunPosition(jDate + t).eqt, 24);
  const angleTime = (angle: number, t: number, before = false) => {
    const { decl } = sunPosition(jDate + t);
    const noon = midDay(t);
    const T = acos((-sin(angle) - sin(decl) * sin(loc.lat)) / (cos(decl) * cos(loc.lat))) / 15;
    return noon + (before ? -T : T);
  };
  const asrTime = (t: number) => {
    const { decl } = sunPosition(jDate + t);
    return angleTime(-acot(method.asrFactor + tan(Math.abs(loc.lat - decl))), t);
  };

  // Hours in local mean solar time; two passes refine the estimate.
  let h = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const p = (x: number) => x / 24;
    h = {
      fajr: angleTime(method.fajrAngle, p(h.fajr), true),
      sunrise: angleTime(0.833, p(h.sunrise), true),
      dhuhr: midDay(p(h.dhuhr)),
      asr: asrTime(p(h.asr)),
      sunset: angleTime(0.833, p(h.sunset)),
      isha: angleTime(method.ishaAngle, p(h.isha)),
    };
    // High-latitude safeguard (angle-based): Fajr/Isha never further than angle/60 of the night.
    const night = 24 - (h.sunset - h.sunrise);
    const fajrMax = (method.fajrAngle / 60) * night;
    const ishaMax = (method.ishaAngle / 60) * night;
    if (Number.isNaN(h.fajr) || h.sunrise - h.fajr > fajrMax) h.fajr = h.sunrise - fajrMax;
    if (Number.isNaN(h.isha) || h.isha - h.sunset > ishaMax) h.isha = h.sunset + ishaMax;
  }

  const base = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  const toDate = (hours: number) => {
    const ms = base + (hours - loc.lng / 15) * 3_600_000;
    return new Date(Math.round(ms / 60_000) * 60_000);
  };

  return {
    fajr: toDate(h.fajr),
    sunrise: toDate(h.sunrise),
    dhuhr: toDate(h.dhuhr),
    asr: toDate(h.asr),
    maghrib: toDate(h.sunset),
    isha: toDate(h.isha),
  };
}

/** Sun altitude above the horizon in degrees at a given instant. */
export function solarAltitude(when: Date, loc: PrayerLocation): number {
  const ms = when.getTime();
  const { decl, eqt } = sunPosition(ms / 86_400_000 + 2440587.5);
  const utcHours = fix(ms, 86_400_000) / 3_600_000;
  const hourAngle = 15 * (utcHours + loc.lng / 15 + eqt - 12);
  return asin(sin(loc.lat) * sin(decl) + cos(loc.lat) * cos(decl) * cos(hourAngle));
}
