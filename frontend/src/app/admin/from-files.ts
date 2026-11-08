import { JumuahDoc, minutesToHhmm, PRAYER_KEYS, SalahKey, TimePair } from '../core/firestore-schema';
import { MasjidData } from '../core/masjid-data';
import { computeDay, ISNA } from '../core/prayer-calc';
import { addDays, Ymd, ymdKey, zonedMidnight, zonedYmd } from '../core/zoned-time';

/**
 * Fills the admin forms from the CSV files the site used before Firestore: the yearly iqamah
 * schedule (adhan = iqamah − the configured minutes; Maghrib = that day's sunset + N) and jumuah.csv.
 */

const weekday = ({ y, m, d }: Ymd) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

export const todayKey = (data: MasjidData) => ymdKey(zonedYmd(new Date(), data.config().masjid.timeZone));

/** The coming Sunday (a week from today if today is Sunday). */
export function comingSunday(data: MasjidData): string {
  const today = zonedYmd(new Date(), data.config().masjid.timeZone);
  return ymdKey(addDays(today, 7 - weekday(today)));
}

export interface PrayersFromFiles {
  current: Record<SalahKey, TimePair>;
  next: Record<SalahKey, TimePair>;
  effectiveDate: string;
}

export function prayersFromFiles(data: MasjidData): PrayersFromFiles {
  const { timeZone, latitude, longitude, city, region } = data.config().masjid;
  const schedule = data.schedule();
  const today = zonedYmd(new Date(), timeZone);

  const sunsetMinutes = (ymd: Ymd): number => {
    const published = data.sun().get(ymdKey(ymd));
    if (published) return published.sunset;
    const calc = computeDay(ymd, { name: city, region, lat: latitude, lng: longitude, timeZone }, ISNA);
    return Math.round((calc.maghrib.getTime() - zonedMidnight(ymd, timeZone).getTime()) / 60_000);
  };

  const timesOn = (ymd: Ymd): Record<SalahKey, TimePair> => {
    const day = schedule.get(ymdKey(ymd));
    if (!day) throw new Error(`${ymdKey(ymd)} isn't in the iqamah schedule file.`);
    const offsets = data.config().adhanMinutesBeforeIqamah;
    const iqamah: Record<SalahKey, number> = {
      fajr: day.fajr,
      dhuhr: day.dhuhr,
      asr: day.asr,
      maghrib: 'afterSunset' in day.maghrib ? sunsetMinutes(ymd) + day.maghrib.afterSunset : day.maghrib.at,
      isha: day.isha,
    };
    const pair = (k: SalahKey): [SalahKey, TimePair] => [
      k,
      { adhan: minutesToHhmm(iqamah[k] - offsets[k]), iqamah: minutesToHhmm(iqamah[k]) },
    ];
    return Object.fromEntries(PRAYER_KEYS.map(pair)) as Record<SalahKey, TimePair>;
  };

  // Next week starts on the coming Sunday, or earlier if the file's schedule changes before then.
  const sunday = addDays(today, 7 - weekday(today));
  const todayRules = JSON.stringify(schedule.get(ymdKey(today)) ?? null);
  let effective = sunday;
  for (let d = addDays(today, 1); ymdKey(d) < ymdKey(sunday); d = addDays(d, 1)) {
    if (JSON.stringify(schedule.get(ymdKey(d)) ?? null) !== todayRules) {
      effective = d;
      break;
    }
  }
  return { current: timesOn(today), next: timesOn(effective), effectiveDate: ymdKey(effective) };
}

export function jumuahFromFiles(data: MasjidData): Omit<JumuahDoc, 'order'>[] {
  const before = data.config().adhanMinutesBeforeIqamah.jumuah;
  return data.fileJumuah().map((j) => ({
    name: j.name,
    adhan: minutesToHhmm(j.adhan ?? j.iqamah - before),
    khutbah: j.khutbah === null ? null : minutesToHhmm(j.khutbah),
    iqamah: minutesToHhmm(j.iqamah),
    location: j.location,
  }));
}
