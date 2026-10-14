import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { parseClock, parseCsv } from './csv';

/**
 * Where the published data files live. Point this at the raw GitHub folder, e.g.
 * 'https://raw.githubusercontent.com/<owner>/<repo>/main/frontend/public/data/'.
 * When empty, or when GitHub can't be reached, the copy bundled with the app (public/data/) is used.
 */
export const REMOTE_DATA_URL =
  'https://raw.githubusercontent.com/hassanrazakhalid/legacy-musallah-prayers/main/frontend/public/data/';

const BUNDLED_DATA_URL = 'data/';
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
  iqamahSchedules: string[];
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
    name: 'ICSC',
    city: 'Calgary',
    region: 'AB',
    timeZone: 'America/Edmonton',
    latitude: 51.0447,
    longitude: -114.0719,
  },
  iqamahSchedules: ['ICSC_Iqamah_Schedule_fullyear2026_2027.csv'],
  jumuahFile: 'jumuah.csv',
  adhanMinutesBeforeIqamah: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15, jumuah: 30 },
};

/**
 * Loads the masjid's published files (config, iqamah schedule, Jumu'ah) at startup
 * and refreshes them periodically, so screens left open (e.g. the TV) pick up edits.
 */
@Injectable({ providedIn: 'root' })
export class MasjidData {
  readonly config = signal<MasjidConfig>(DEFAULT_CONFIG);
  /** Iqamah schedule keyed by ISO date (YYYY-MM-DD). */
  readonly schedule = signal<ReadonlyMap<string, IqamahDay>>(new Map());
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

    const schedule = new Map<string, IqamahDay>();
    for (const file of config.iqamahSchedules) {
      const res = await this.fetchText(file).catch((e) => (errors.push(String(e)), null));
      if (!res) continue;
      sources.add(res.from);
      for (const [date, day] of parseSchedule(res.text, file, errors)) schedule.set(date, day);
    }

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
    iqamahSchedules: raw.iqamahSchedules?.length ? raw.iqamahSchedules : DEFAULT_CONFIG.iqamahSchedules,
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

function parseSchedule(text: string, file: string, errors: string[]): [string, IqamahDay][] {
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
