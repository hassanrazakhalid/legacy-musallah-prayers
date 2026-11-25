import { computed, DestroyRef, inject, Injectable, isDevMode, signal } from '@angular/core';
import { JUMUAH, PRAYERS } from './firestore-schema';
import { loadScheduleScript } from './iqamah-ca';
import {
  DEFAULT_CONFIG,
  IqamahDay,
  JumuahSlot,
  MasjidConfig,
  mergeConfig,
  parseFirestoreJumuah,
  parseJumuah,
  parseSchedule,
  parseSun,
  parseWeekly,
  SunDay,
  WeeklySchedule,
} from './masjid-parse';

export type {
  AdhanOffsets,
  IqamahDay,
  JumuahSlot,
  MasjidConfig,
  SalahTimes,
  SunDay,
  WeeklyPrayer,
  WeeklySchedule,
} from './masjid-parse';

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

/** 'firestore': times from the admin page. 'remote'/'bundled': the CSV files (GitHub or the copy in the app). */
export type DataSource = 'firestore' | 'remote' | 'bundled';

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
          this.weekly.set(parseWeekly(snap.docs.map((d) => ({ id: d.id, data: d.data() }))));
          done();
        },
        onError(PRAYERS),
      );
      const stopJumuah = onSnapshot(
        collection(db, JUMUAH),
        (snap) => {
          if (snap.empty && snap.metadata.fromCache) return;
          this.firestoreJumuah.set(parseFirestoreJumuah(snap.docs.map((d) => ({ id: d.id, data: d.data() }))));
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
