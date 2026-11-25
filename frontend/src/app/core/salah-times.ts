import { PRAYER_KEYS, SalahKey, timesOn } from './firestore-schema';
import { AdhanOffsets, IqamahDay, SalahTimes, SunDay, WeeklySchedule } from './masjid-parse';
import { CalcMethod, computeDay, DayTimes, PrayerLocation } from './prayer-calc';
import { Ymd, ymdKey, zonedDateTime } from './zoned-time';

/**
 * Which adhan and iqamah apply on a date. Plain functions shared by the display (PrayerStore) and
 * the calendar generator (scripts/calendar), so both always show the same times.
 */
export interface ScheduleInputs {
  location: PrayerLocation;
  method: CalcMethod;
  /** Adhan = iqamah − these minutes, for dates from the CSV schedule. */
  offsets: AdhanOffsets;
  /** The admin page's times (Firestore); null when it hasn't published all five prayers. */
  weekly: WeeklySchedule | null;
  /** The CSV iqamah schedule, keyed by ISO date. */
  schedule: ReadonlyMap<string, IqamahDay>;
  /** iqamah.ca's sunrise and sunset, keyed by ISO date. */
  sun: ReadonlyMap<string, SunDay>;
}

export type DaySalah = Record<SalahKey, { adhan: Date; iqamah: Date }>;

const minutes = (n: number) => n * 60_000;

/**
 * Sunrise and sunset for a date: iqamah.ca's published times when it has the date, otherwise
 * calculated. Sunset is the Maghrib adhan.
 */
export function publishedSun(inputs: ScheduleInputs, ymd: Ymd, calc: DayTimes): { sunrise: Date; sunset: Date } {
  const day = inputs.sun.get(ymdKey(ymd));
  if (!day) return { sunrise: calc.sunrise, sunset: calc.maghrib };
  const tz = inputs.location.timeZone;
  return { sunrise: zonedDateTime(ymd, day.sunrise, tz), sunset: zonedDateTime(ymd, day.sunset, tz) };
}

/**
 * The admin page's times for a date: next week's from its effective date, otherwise this week's,
 * plus any dated +/- changes (see timesOn).
 * Null when the admin page hasn't published times (the CSV schedule is used instead).
 */
export function weeklyFor(weekly: WeeklySchedule | null, ymd: Ymd): Record<SalahKey, SalahTimes> | null {
  if (!weekly) return null;
  const key = ymdKey(ymd);
  return Object.fromEntries(PRAYER_KEYS.map((k) => [k, timesOn(weekly.get(k)!, key)])) as Record<SalahKey, SalahTimes>;
}

/** Adhan and iqamah for a date: the admin page's times, else the CSV (adhan = iqamah − minutes). */
export function salahFor(inputs: ScheduleInputs, ymd: Ymd, sunset: Date): DaySalah | null {
  const tz = inputs.location.timeZone;
  const at = (mins: number) => zonedDateTime(ymd, mins, tz);
  const weekly = weeklyFor(inputs.weekly, ymd);
  if (weekly) {
    const entry = (k: SalahKey) => [k, { adhan: at(weekly[k].adhan), iqamah: at(weekly[k].iqamah) }];
    return Object.fromEntries(PRAYER_KEYS.map(entry));
  }
  const day = inputs.schedule.get(ymdKey(ymd));
  if (!day) return null;
  const iqamah: Record<SalahKey, Date> = {
    fajr: at(day.fajr),
    dhuhr: at(day.dhuhr),
    asr: at(day.asr),
    maghrib: 'afterSunset' in day.maghrib ? new Date(sunset.getTime() + minutes(day.maghrib.afterSunset)) : at(day.maghrib.at),
    isha: at(day.isha),
  };
  const entry = (k: SalahKey) => [k, { iqamah: iqamah[k], adhan: new Date(iqamah[k].getTime() - minutes(inputs.offsets[k])) }];
  return Object.fromEntries(PRAYER_KEYS.map(entry));
}

/** The published adhan and iqamah for a date, or null when no schedule covers it. */
export function publishedSalahOn(inputs: ScheduleInputs, ymd: Ymd): DaySalah | null {
  const { sunset } = publishedSun(inputs, ymd, computeDay(ymd, inputs.location, inputs.method));
  return salahFor(inputs, ymd, sunset);
}
