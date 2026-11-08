/**
 * Firestore layout. Times are 24-hour local clock strings ("05:40", "13:30") in the masjid's time zone.
 *
 *   prayers/{fajr|dhuhr|asr|maghrib|isha}  PrayerDoc   (incl. dated +/- minute changes)
 *   jumuah/{auto id}                       JumuahDoc   (sorted by `order`)
 *   users/{auth uid}                       UserDoc     (role 'admin' may edit; managed in the Firebase console)
 */

export const PRAYERS = 'prayers';
export const JUMUAH = 'jumuah';
export const USERS = 'users';

export const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type SalahKey = (typeof PRAYER_KEYS)[number];

export const PRAYER_NAMES: Record<SalahKey, string> = {
  fajr: 'Fajr',
  dhuhr: 'Zuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export interface TimePair {
  adhan: string;
  iqamah: string;
}

export interface PrayerDoc {
  order: number;
  name: string;
  /** This week's times. */
  current: TimePair;
  /** Next week's times and the date (YYYY-MM-DD) they take effect; null when nothing is scheduled. */
  next: (TimePair & { effectiveDate: string }) | null;
  /** Shift adhan and iqamah by `minutes` from `date` on (cumulative). Missing or empty: none. */
  adjustments?: Adjustment[];
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface Adjustment {
  /** YYYY-MM-DD */
  date: string;
  /** e.g. 10 or -15 */
  minutes: number;
}

export interface JumuahDoc {
  order: number;
  name: string;
  adhan: string;
  /** Empty when there's no separate khutbah time. */
  khutbah: string | null;
  iqamah: string;
  location: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface UserDoc {
  email: string;
  name?: string;
  role: 'admin' | string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhmm = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const isAdjustment = (a: unknown): a is Adjustment =>
  !!a &&
  isIsoDate((a as Adjustment).date) &&
  Number.isInteger((a as Adjustment).minutes) &&
  Math.abs((a as Adjustment).minutes) <= 720;

/** One prayer's schedule in minutes after midnight. */
export interface PrayerSchedule {
  current: { adhan: number; iqamah: number };
  next: { adhan: number; iqamah: number; effectiveDate: string } | null;
  adjustments: Adjustment[];
}

/**
 * The adhan and iqamah in effect on `date` (YYYY-MM-DD): next week's times from their start date,
 * otherwise this week's; plus every +/- change dated on or before `date`. Next week's times are
 * exactly as entered, so only changes on or after its start date apply on top of them.
 * Used by both the display and the admin page, so they always agree.
 */
export function timesOn(p: PrayerSchedule, date: string): { adhan: number; iqamah: number } {
  const useNext = !!p.next && p.next.effectiveDate <= date;
  const base = useNext ? p.next! : p.current;
  const from = useNext ? p.next!.effectiveDate : '';
  const shift = p.adjustments
    .filter((a) => a.date >= from && a.date <= date)
    .reduce((sum, a) => sum + a.minutes, 0);
  const wrap = (m: number) => (((m + shift) % 1440) + 1440) % 1440;
  return { adhan: wrap(base.adhan), iqamah: wrap(base.iqamah) };
}

/** "05:40" → 340. */
export const hhmmToMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

/** 340 → "05:40" (wraps around midnight). */
export function minutesToHhmm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
