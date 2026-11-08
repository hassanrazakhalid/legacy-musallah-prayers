import { computed, DestroyRef, inject, Injectable, isDevMode, signal } from '@angular/core';
import type { QuerySnapshot } from 'firebase/firestore';
import { parseClock, parseCsv } from './csv';
import { hhmmToMinutes, isHhmm, isIsoDate, JUMUAH, PRAYER_KEYS, PRAYERS, SalahKey } from './firestore-schema';
import { loadScheduleScript, RawSchedule } from './iqamah-ca';

/**
 * Where the published data files live. Point this at the raw GitHub folder, e.g.
 * 'https://raw.githubusercontent.com/<owner>/<repo>/main/frontend/public/data/'.
 * When empty, or when GitHub can't be reached, the copy bundled with the app (public/data/) is used.
 * In development (ng serve) it's empty, so edits to public/data/ show on reload without pushing.
 */
export const REMOTE_DATA_URL = isDevMode()
  ? ''
  : 'https://raw.githubusercontent.com/hassanrazakhalid/legacy-musallah-prayers/main/frontend/public/data/';

const BUNDLED_DATA_URL = 'data/';
/** Snapshot of iqamah.ca's salahschedule.js, used when iqamah.ca can't be reached. */
const BUNDLED_SALAH = BUNDLED_DATA_URL + 'iqamah.ca/salahschedule.js';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
/** How long first render waits for Firestore before showing the bundled files. */
const FIRESTORE_WAIT_MS = 5000;

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

/** One prayer from the admin page (Firestore): this week's times and, optionally, next week's. */
export interface WeeklyPrayer {
  current: SalahTimes;
  next: (SalahTimes & { effectiveDate: string }) | null;
}

export type WeeklySchedule = ReadonlyMap<SalahKey, WeeklyPrayer>;

/** 'firestore': times from the admin page. 'remote'/'bundled': the CSV files (GitHub or the copy in the app). */
export type DataSource = 'firestore' | 'remote' | 'bundled';

const DEFAULT_CONFIG: MasjidConfig = {
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

/**
 * Loads the masjid's files (config, iqamah schedule, Jumu'ah, and iqamah.ca's sunrise/sunset) on every page load
 * and refreshes them periodically, so screens left open (e.g. the TV) pick up edits.
 */
@Injectable({ providedIn: 'root' })
export class MasjidData {
  readonly config = signal<MasjidConfig>(DEFAULT_CONFIG);
  /** Iqamah schedule keyed by ISO date (YYYY-MM-DD). */
  readonly schedule = signal<ReadonlyMap<string, IqamahDay>>(new Map());
  /** Sunrise and sunset from iqamah.ca, keyed by ISO date. */
  readonly sun = signal<ReadonlyMap<string, SunDay>>(new Map());
  /** Jumu'ah from jumuah.csv. */
  readonly fileJumuah = signal<JumuahSlot[]>([]);
  private readonly fileSource = signal<DataSource | null>(null);
  readonly errors = signal<string[]>([]);

  /**
   * Prayer times from the admin page, live. Null until Firestore has all five prayers, in which case
   * the display uses the CSV schedule instead.
   */
  readonly weekly = signal<WeeklySchedule | null>(null);
  private readonly firestoreJumuah = signal<JumuahSlot[] | null>(null);

  /** Once the admin page has published prayer times, Jumu'ah comes from Firestore too (even if empty). */
  readonly jumuah = computed(() => (this.weekly() && this.firestoreJumuah()) || this.fileJumuah());
  readonly source = computed<DataSource | null>(() => (this.weekly() ? 'firestore' : this.fileSource()));

  private firestoreReady?: Promise<void>;

  constructor() {
    const id = setInterval(() => this.load(), REFRESH_MS);
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => clearInterval(id));
    this.firestoreReady = this.listen(destroy);
  }

  /** Loads the files; the first call also waits (briefly) for Firestore's first answer. */
  async load(): Promise<void> {
    const ready = this.firestoreReady;
    this.firestoreReady = undefined;
    await Promise.all([this.loadFiles(), ready]);
  }

  /**
   * Subscribes to the prayers and jumuah collections. Resolves once the first prayer snapshot
   * arrives (from the server or the offline cache), or after FIRESTORE_WAIT_MS.
   */
  private listen(destroy: DestroyRef): Promise<void> {
    return new Promise<void>(async (resolve) => {
      const timer = setTimeout(resolve, FIRESTORE_WAIT_MS);
      const done = () => (clearTimeout(timer), resolve());
      // Loaded on demand so the Firestore SDK stays out of the main bundle.
      let sdk: [typeof import('./firebase'), typeof import('firebase/firestore')];
      try {
        sdk = await Promise.all([import('./firebase'), import('firebase/firestore')]);
      } catch (e) {
        console.warn('[masjid-data] could not load Firebase: using the files instead', e);
        return done();
      }
      const [{ db }, { collection, onSnapshot }] = sdk;
      const onError = (what: string) => (e: unknown) => {
        console.warn(`[masjid-data] Firestore ${what}: using the files instead`, e);
        done();
      };
      const stopPrayers = onSnapshot(
        collection(db, PRAYERS),
        (snap) => {
          // An empty answer from the offline cache only means we haven't heard from the server yet.
          if (snap.empty && snap.metadata.fromCache) return;
          this.weekly.set(parseWeekly(snap));
          done();
        },
        onError(PRAYERS),
      );
      const stopJumuah = onSnapshot(
        collection(db, JUMUAH),
        (snap) => {
          if (snap.empty && snap.metadata.fromCache) return;
          this.firestoreJumuah.set(parseFirestoreJumuah(snap));
        },
        onError(JUMUAH),
      );
      destroy.onDestroy(() => (stopPrayers(), stopJumuah()));
    });
  }

  private async loadFiles(): Promise<void> {
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

    const sun = await this.loadSun(config, errors, sources);

    const jumuahRes = await this.fetchText(config.jumuahFile).catch((e) => (errors.push(String(e)), null));
    if (jumuahRes) sources.add(jumuahRes.from);

    // Keep the previous data if a refresh fails entirely.
    this.config.set(config);
    if (schedule.size) this.schedule.set(schedule);
    if (sun.size) this.sun.set(sun);
    if (jumuahRes) this.fileJumuah.set(parseJumuah(jumuahRes.text, config.jumuahFile, errors));
    if (sources.size) this.fileSource.set(sources.has('bundled') ? 'bundled' : 'remote');
    this.errors.set(errors);
    errors.forEach((e) => console.warn('[masjid-data]', e));
  }

  /** Sunrise/sunset from iqamah.ca; the bundled snapshot if it's unreachable. */
  private async loadSun(config: MasjidConfig, errors: string[], sources: Set<DataSource>) {
    const attempts: [string, DataSource][] = [
      [config.salahScheduleUrl, 'remote'],
      [BUNDLED_SALAH, 'bundled'],
    ];
    for (const [url, from] of attempts) {
      try {
        const salah = await loadScheduleScript(url, 'SALAH_SCHEDULE');
        if (!salah) throw new Error(`${url}: no SALAH_SCHEDULE found`);
        sources.add(from);
        return parseSun(salah, errors);
      } catch (e) {
        errors.push(String(e));
      }
    }
    return new Map<string, SunDay>();
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

/** Sunrise and sunset (the Maghrib time) from iqamah.ca's SALAH_SCHEDULE. */
function parseSun(salah: RawSchedule, errors: string[]): Map<string, SunDay> {
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
        adhan: null,
        khutbah: parseClock(column(row, 'Khutbah')),
        iqamah,
        location: column(row, 'Location'),
      },
    ];
  });
}

/** All five prayers with valid times, or null (so the display falls back to the files). */
function parseWeekly(snap: QuerySnapshot): WeeklySchedule | null {
  const out = new Map<SalahKey, WeeklyPrayer>();
  const times = (v: unknown): SalahTimes | null => {
    const t = v as Partial<Record<keyof SalahTimes, unknown>> | null | undefined;
    return t && isHhmm(t.adhan) && isHhmm(t.iqamah) ? { adhan: hhmmToMinutes(t.adhan), iqamah: hhmmToMinutes(t.iqamah) } : null;
  };
  for (const d of snap.docs) {
    const key = d.id as SalahKey;
    if (!PRAYER_KEYS.includes(key)) continue;
    const data = d.data();
    const current = times(data['current']);
    const next = times(data['next']);
    const effectiveDate = data['next']?.effectiveDate;
    if (!current) {
      console.warn(`[masjid-data] prayers/${key}: could not read`, data);
      continue;
    }
    out.set(key, { current, next: next && isIsoDate(effectiveDate) ? { ...next, effectiveDate } : null });
  }
  const missing = PRAYER_KEYS.filter((k) => !out.has(k));
  if (missing.length) {
    if (snap.size) console.warn(`[masjid-data] Firestore is missing ${missing.join(', ')}: using the files`);
    return null;
  }
  return out;
}

function parseFirestoreJumuah(snap: QuerySnapshot): JumuahSlot[] {
  return snap.docs
    .map((d) => d.data())
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
