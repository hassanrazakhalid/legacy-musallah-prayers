import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { parseClock, parseCsv } from './csv';
import { loadIqamahCa, RawSchedule } from './iqamah-ca';

/**
 * Where the published data files live. Point this at the raw GitHub folder, e.g.
 * 'https://raw.githubusercontent.com/<owner>/<repo>/main/frontend/public/data/'.
 * When empty, or when GitHub can't be reached, the copy bundled with the app (public/data/) is used.
 */
export const REMOTE_DATA_URL =
  'https://raw.githubusercontent.com/hassanrazakhalid/legacy-musallah-prayers/main/frontend/public/data/';

const BUNDLED_DATA_URL = 'data/';
/** Snapshot of the iqamah.ca scripts, used when iqamah.ca can't be reached. */
const BUNDLED_SALAH = BUNDLED_DATA_URL + 'iqamah.ca/salahschedule.js';
const BUNDLED_IQAMAH = BUNDLED_DATA_URL + 'iqamah.ca/schedule.js';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

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
  /** iqamah.ca data scripts: adhan times (SALAH_SCHEDULE) and iqamah times (IQAMAH_SCHEDULE). */
  salahScheduleUrl: string;
  iqamahScheduleUrl: string;
  jumuahFile: string;
  /** Only Jumu'ah uses this now; the daily adhan times come from the salah schedule. */
  adhanMinutesBeforeIqamah: Pick<AdhanOffsets, 'jumuah'>;
}

export type SchedulePrayer = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** An iqamah: a clock time, or minutes after that prayer's adhan ("Sunset+ 10 min", "Isha+ 30 min"). */
export type IqamahTime = { at: number } | { afterAdhan: number };

/** One date of the published schedule; times are minutes after local midnight. */
export interface ScheduleDay {
  adhan: Record<SchedulePrayer | 'sunrise', number>;
  /** Missing when the iqamah schedule has no usable value for that prayer. */
  iqamah: Partial<Record<SchedulePrayer, IqamahTime>>;
}

export interface JumuahSlot {
  name: string;
  /** Minutes after local midnight. */
  khutbah: number | null;
  /** Minutes after local midnight. */
  iqamah: number;
  location: string;
}

export type DataSource = 'remote' | 'bundled';

const DEFAULT_CONFIG: MasjidConfig = {
  masjid: {
    name: 'Legacy Musallah',
    city: 'Calgary',
    region: 'AB',
    timeZone: 'America/Edmonton',
    latitude: 51.0447,
    longitude: -114.0719,
  },
  salahScheduleUrl: 'https://iqamah.ca/salahschedule.js',
  iqamahScheduleUrl: 'https://iqamah.ca/schedule.js',
  jumuahFile: 'jumuah.csv',
  adhanMinutesBeforeIqamah: { jumuah: 30 },
};

/**
 * Loads the masjid's files (config, iqamah.ca adhan + iqamah schedules, Jumu'ah) on every page load
 * and refreshes them periodically, so screens left open (e.g. the TV) pick up edits.
 */
@Injectable({ providedIn: 'root' })
export class MasjidData {
  readonly config = signal<MasjidConfig>(DEFAULT_CONFIG);
  /** Adhan + iqamah schedule keyed by ISO date (YYYY-MM-DD). */
  readonly schedule = signal<ReadonlyMap<string, ScheduleDay>>(new Map());
  readonly jumuah = signal<JumuahSlot[]>([]);
  readonly source = signal<DataSource | null>(null);
  readonly errors = signal<string[]>([]);

  constructor() {
    const id = setInterval(() => this.load(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  async load(): Promise<void> {
    const errors: string[] = [];
    const sources = new Set<DataSource>();

    const configFile = await this.fetchText('prayer-config.json').catch((e) => (errors.push(String(e)), null));
    let config = this.config();
    if (configFile) {
      sources.add(configFile.from);
      try {
        config = mergeConfig(JSON.parse(configFile.text));
      } catch (e) {
        errors.push(`prayer-config.json: ${e}`);
      }
    }

    const schedule = await this.loadSchedule(config, errors, sources);

    const jumuahRes = await this.fetchText(config.jumuahFile).catch((e) => (errors.push(String(e)), null));
    if (jumuahRes) sources.add(jumuahRes.from);

    // Keep the previous data if a refresh fails entirely.
    this.config.set(config);
    if (schedule.size) this.schedule.set(schedule);
    if (jumuahRes) this.jumuah.set(parseJumuah(jumuahRes.text, config.jumuahFile, errors));
    if (sources.size) this.source.set(sources.has('bundled') ? 'bundled' : 'remote');
    this.errors.set(errors);
    errors.forEach((e) => console.warn('[masjid-data]', e));
  }

  /** iqamah.ca first; the bundled snapshot if it's unreachable or incomplete. */
  private async loadSchedule(config: MasjidConfig, errors: string[], sources: Set<DataSource>) {
    const attempts: [string, string, DataSource][] = [
      [config.salahScheduleUrl, config.iqamahScheduleUrl, 'remote'],
      [BUNDLED_SALAH, BUNDLED_IQAMAH, 'bundled'],
    ];
    for (const [salahUrl, iqamahUrl, from] of attempts) {
      try {
        const files = await loadIqamahCa(salahUrl, iqamahUrl);
        if (!files.salah || !files.iqamah) throw new Error(`${files.salah ? iqamahUrl : salahUrl}: no schedule found`);
        sources.add(from);
        return buildSchedule(files.salah, files.iqamah, errors);
      } catch (e) {
        errors.push(String(e));
      }
    }
    return new Map<string, ScheduleDay>();
  }

  private async fetchText(file: string): Promise<{ text: string; from: DataSource }> {
    if (REMOTE_DATA_URL) {
      try {
        return { text: await fetchWithTimeout(REMOTE_DATA_URL + file), from: 'remote' };
      } catch (e) {
        console.warn(`[masjid-data] ${file}: remote unavailable, using bundled copy`, e);
      }
    }
    return { text: await fetchWithTimeout(BUNDLED_DATA_URL + file), from: 'bundled' };
  }
}

async function fetchWithTimeout(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function mergeConfig(raw: Partial<MasjidConfig>): MasjidConfig {
  return {
    masjid: { ...DEFAULT_CONFIG.masjid, ...raw.masjid },
    salahScheduleUrl: raw.salahScheduleUrl || DEFAULT_CONFIG.salahScheduleUrl,
    iqamahScheduleUrl: raw.iqamahScheduleUrl || DEFAULT_CONFIG.iqamahScheduleUrl,
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

const SCHEDULE_KEYS: Record<SchedulePrayer, string> = {
  fajr: 'fajr',
  dhuhr: 'zuhr',
  asr: 'asr',
  maghrib: 'maghrib',
  isha: 'isha',
};

/** Joins the adhan and iqamah files by date. Dates without a complete adhan entry are skipped. */
function buildSchedule(salah: RawSchedule, iqamah: RawSchedule, errors: string[]): Map<string, ScheduleDay> {
  const out = new Map<string, ScheduleDay>();
  for (const [date, raw] of Object.entries(salah)) {
    const pick = (key: string) => parseClock(raw[key] ?? raw[key === 'zuhr' ? 'dhuhr' : key] ?? '');
    const adhan = {
      fajr: pick('fajr'),
      sunrise: pick('sunrise'),
      dhuhr: pick('zuhr'),
      asr: pick('asr'),
      maghrib: pick('maghrib'),
      isha: pick('isha'),
    };
    if (Object.values(adhan).some((v) => v === null)) {
      errors.push(`salah schedule ${date}: could not read ${JSON.stringify(raw)}`);
      continue;
    }
    const day: ScheduleDay = { adhan: adhan as ScheduleDay['adhan'], iqamah: {} };
    const iq = iqamah[date] ?? {};
    for (const [key, field] of Object.entries(SCHEDULE_KEYS) as [SchedulePrayer, string][]) {
      const value = parseIqamah(iq[field] ?? iq[key] ?? '');
      if (value) day.iqamah[key] = value;
      else if (iqamah[date]) errors.push(`iqamah schedule ${date} ${field}: could not read ${JSON.stringify(iq[field])}`);
    }
    out.set(date, day);
  }
  return out;
}

/** "7:10 AM" → clock time; "Sunset+ 10 min" / "Fajr+ 10 min" → minutes after that prayer's adhan. */
function parseIqamah(value: string): IqamahTime | null {
  const relative = value.match(/\+\s*(\d+)/);
  if (relative) return { afterAdhan: Number(relative[1]) };
  const at = parseClock(value);
  return at === null ? null : { at };
}

function parseJumuah(text: string, file: string, errors: string[]): JumuahSlot[] {
  return parseCsv(text).flatMap((row, i) => {
    const iqamah = parseClock(column(row, 'Iqamah', 'Time'));
    if (iqamah === null) {
      errors.push(`${file} row ${i + 2}: could not read ${JSON.stringify(row)}`);
      return [];
    }
    return [
      {
        name: column(row, 'Name') || `Jumu'ah ${i + 1}`,
        khutbah: parseClock(column(row, 'Khutbah')),
        iqamah,
        location: column(row, 'Location'),
      },
    ];
  });
}
