/**
 * Firestore layout. Times are 24-hour local clock strings ("05:40", "13:30") in the masjid's time zone.
 *
 *   prayers/{fajr|dhuhr|asr|maghrib|isha}  PrayerDoc
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
  updatedAt?: unknown;
  updatedBy?: string;
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

/** "05:40" → 340. */
export const hhmmToMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

/** 340 → "05:40" (wraps around midnight). */
export function minutesToHhmm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
