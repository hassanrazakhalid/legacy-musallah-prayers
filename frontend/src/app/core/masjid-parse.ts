import { parseClock, parseCsv } from './csv';
import { hhmmToMinutes, isAdjustment, isHhmm, isIsoDate, PRAYER_KEYS, PrayerSchedule, SalahKey } from './firestore-schema';

/**
 * The masjid's data model and the parsers that read it from the files, iqamah.ca and Firestore.
 * Plain functions with no Angular or Firebase imports, so the calendar generator
 * (scripts/calendar) reads the data exactly as the display does.
 */

/** Raw day records from an iqamah.ca data script, keyed by ISO date: { sunrise: "8:27 AM", ... }. */
export type RawSchedule = Record<string, Record<string, string>>;

/** A Firestore document as plain data, from the SDK (`{ id: d.id, data: d.data() }`) or the REST API. */
export interface DocData {
  id: string;
  data: Record<string, any>;
}

export interface AdhanOffsets {
  fajr: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
  jumuah: number;
}

export interface MasjidConfig {
  masjid: { name: string; city: string; region: string; timeZone: string; latitude: number; longitude: number };
  iqamahSchedules: string[];
  /** iqamah.ca's salahschedule.js (SALAH_SCHEDULE): only its sunrise and sunset (Maghrib) times are used. */
  salahScheduleUrl: string;
  jumuahFile: string;
  adhanMinutesBeforeIqamah: AdhanOffsets;
}

/** Iqamah times for one date, in minutes after local midnight. */
export interface IqamahDay {
  fajr: number;
  dhuhr: number;
  asr: number;
  isha: number;
  /** A fixed clock time, or minutes after sunset ("Sunset+ 10 min"). */
  maghrib: { at: number } | { afterSunset: number };
}

/** Sunrise and sunset for one date, in minutes after local midnight. */
export interface SunDay {
  sunrise: number;
  sunset: number;
}

export interface JumuahSlot {
  name: string;
  /** Minutes after local midnight; null means iqamah minus the configured Jumu'ah minutes. */
  adhan: number | null;
  /** Minutes after local midnight. */
  khutbah: number | null;
  /** Minutes after local midnight. */
  iqamah: number;
  location: string;
}

/** Adhan and iqamah in minutes after local midnight. */
export interface SalahTimes {
  adhan: number;
  iqamah: number;
}

/** One prayer from the admin page (Firestore): this week, optionally next week, and dated +/- changes. */
export type WeeklyPrayer = PrayerSchedule;

export type WeeklySchedule = ReadonlyMap<SalahKey, WeeklyPrayer>;

export const DEFAULT_CONFIG: MasjidConfig = {
  masjid: {
    name: 'Legacy Musallah',
    city: 'Calgary',
    region: 'AB',
    // Alberta Time: UTC−6 year-round since Nov 1, 2026. A fixed zone, because browsers with older
    // time-zone data still move America/Edmonton back an hour, which would shift every time.
    timeZone: 'Etc/GMT+6',
    latitude: 51.0447,
    longitude: -114.0719,
  },
  iqamahSchedules: ['ICSC_Iqamah_Schedule_fullyear2026_2027.csv'],
  salahScheduleUrl: 'https://iqamah.ca/salahschedule.js',
  jumuahFile: 'jumuah.csv',
  adhanMinutesBeforeIqamah: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15, jumuah: 30 },
};

export function mergeConfig(raw: Partial<MasjidConfig>): MasjidConfig {
  return {
    masjid: { ...DEFAULT_CONFIG.masjid, ...raw.masjid },
    iqamahSchedules: raw.iqamahSchedules?.length ? raw.iqamahSchedules : DEFAULT_CONFIG.iqamahSchedules,
    salahScheduleUrl: raw.salahScheduleUrl || DEFAULT_CONFIG.salahScheduleUrl,
    jumuahFile: raw.jumuahFile ?? DEFAULT_CONFIG.jumuahFile,
    adhanMinutesBeforeIqamah: { ...DEFAULT_CONFIG.adhanMinutesBeforeIqamah, ...raw.adhanMinutesBeforeIqamah },
  };
}

/** Case-insensitive column lookup, tolerating spelling variants (Zuhr/Dhuhr). */
function column(row: Record<string, string>, ...names: string[]): string {
  const wanted = names.map((n) => n.toLowerCase());
  const key = Object.keys(row).find((k) => wanted.includes(k.toLowerCase()));
  return key ? row[key] : '';
}

export function parseSchedule(text: string, file: string, errors: string[]): [string, IqamahDay][] {
  const out: [string, IqamahDay][] = [];
  parseCsv(text).forEach((row, i) => {
    const date = column(row, 'Date');
    const fajr = parseClock(column(row, 'Fajr'));
    const dhuhr = parseClock(column(row, 'Zuhr', 'Dhuhr', 'Duhr'));
    const asr = parseClock(column(row, 'Asr'));
    const isha = parseClock(column(row, 'Isha'));
    const maghribRaw = column(row, 'Maghrib');
    const afterSunset = maghribRaw.match(/sunset\s*\+\s*(\d+)/i);
    const maghribAt = parseClock(maghribRaw);
    const maghrib = afterSunset ? { afterSunset: Number(afterSunset[1]) } : maghribAt !== null ? { at: maghribAt } : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || fajr === null || dhuhr === null || asr === null || isha === null || !maghrib) {
      errors.push(`${file} row ${i + 2}: could not read ${JSON.stringify(row)}`);
      return;
    }
    out.push([date, { fajr, dhuhr, asr, isha, maghrib }]);
  });
  return out;
}

/** Sunrise and sunset (the Maghrib time) from iqamah.ca's SALAH_SCHEDULE. */
export function parseSun(salah: RawSchedule, errors: string[]): Map<string, SunDay> {
  const out = new Map<string, SunDay>();
  for (const [date, raw] of Object.entries(salah)) {
    const sunrise = parseClock(raw['sunrise'] ?? '');
    const sunset = parseClock(raw['maghrib'] ?? raw['sunset'] ?? '');
    if (sunrise === null || sunset === null) {
      errors.push(`salahschedule.js ${date}: could not read ${JSON.stringify(raw)}`);
      continue;
    }
    out.set(date, { sunrise, sunset });
  }
  return out;
}

export function parseJumuah(text: string, file: string, errors: string[]): JumuahSlot[] {
  return parseCsv(text).flatMap((row, i) => {
    const iqamah = parseClock(column(row, 'Iqamah', 'Time'));
    if (iqamah === null) {
      errors.push(`${file} row ${i + 2}: could not read ${JSON.stringify(row)}`);
      return [];
    }
    return [
      {
        name: column(row, 'Name') || `Jumu'ah ${i + 1}`,
        adhan: null,
        khutbah: parseClock(column(row, 'Khutbah')),
        iqamah,
        location: column(row, 'Location'),
      },
    ];
  });
}

/** All five prayers with valid times, or null (so the display falls back to the files). */
export function parseWeekly(docs: DocData[]): WeeklySchedule | null {
  const out = new Map<SalahKey, WeeklyPrayer>();
  const times = (v: unknown): SalahTimes | null => {
    const t = v as Partial<Record<keyof SalahTimes, unknown>> | null | undefined;
    return t && isHhmm(t.adhan) && isHhmm(t.iqamah) ? { adhan: hhmmToMinutes(t.adhan), iqamah: hhmmToMinutes(t.iqamah) } : null;
  };
  for (const d of docs) {
    const key = d.id as SalahKey;
    if (!PRAYER_KEYS.includes(key)) continue;
    const data = d.data;
    const current = times(data['current']);
    const next = times(data['next']);
    const effectiveDate = data['next']?.effectiveDate;
    if (!current) {
      console.warn(`[masjid-data] prayers/${key}: could not read`, data);
      continue;
    }
    const adjustments = (Array.isArray(data['adjustments']) ? data['adjustments'] : [])
      .filter(isAdjustment)
      .map(({ date, minutes }) => ({ date, minutes }));
    out.set(key, { current, next: next && isIsoDate(effectiveDate) ? { ...next, effectiveDate } : null, adjustments });
  }
  const missing = PRAYER_KEYS.filter((k) => !out.has(k));
  if (missing.length) {
    if (docs.length) console.warn(`[masjid-data] Firestore is missing ${missing.join(', ')}: using the files`);
    return null;
  }
  return out;
}

export function parseFirestoreJumuah(docs: DocData[]): JumuahSlot[] {
  return docs
    .map((d) => d.data)
    .filter((j) => isHhmm(j['iqamah']))
    .sort((a, b) => (a['order'] ?? 0) - (b['order'] ?? 0))
    .map((j, i) => ({
      name: j['name'] || `Jumu'ah ${i + 1}`,
      adhan: isHhmm(j['adhan']) ? hhmmToMinutes(j['adhan']) : null,
      khutbah: isHhmm(j['khutbah']) ? hhmmToMinutes(j['khutbah']) : null,
      iqamah: hhmmToMinutes(j['iqamah']),
      location: j['location'] ?? '',
    }));
}
