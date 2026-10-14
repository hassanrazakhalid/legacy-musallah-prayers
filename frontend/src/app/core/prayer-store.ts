import { computed, inject, Injectable, signal } from '@angular/core';
import { Clock } from './clock';
import { IqamahDay, MasjidData } from './masjid-data';
import { computeDay, DayTimes, ISNA, PrayerLocation } from './prayer-calc';
import { skyState } from './sky-model';
import { addDays, daysInMonth, sameYmd, Ymd, ymdKey, zonedDateTime, zonedMidnight, zonedYmd } from './zoned-time';

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerRow {
  key: PrayerKey;
  label: string;
  arabic: string;
  adhan: Date;
  iqamah: Date | null;
  /** Set when the published iqamah falls outside the prayer's time window. */
  problem?: string;
}

/** One day's prayers; `published` is false when the masjid schedule has no entry for that date. */
export interface DaySchedule {
  ymd: Ymd;
  published: boolean;
  rows: PrayerRow[];
}

export interface MonthRow extends DaySchedule {
  weekday: string;
  isToday: boolean;
  isFriday: boolean;
}

export interface JumuahRow {
  name: string;
  location: string;
  khutbah: Date | null;
  adhan: Date;
  iqamah: Date;
  state: 'done' | 'next' | 'upcoming';
}

export interface ArcPoint {
  key: PrayerKey;
  label: string;
  time: Date;
}

export interface SkyArc {
  night: boolean;
  /** East horizon: where the sun (day) or moon (night) rises. */
  start: ArcPoint;
  /** West horizon: where it sets. */
  end: ArcPoint;
  markers: ArcPoint[];
}

const META: Record<PrayerKey, { label: string; arabic: string }> = {
  fajr: { label: 'Fajr', arabic: 'الفجر' },
  sunrise: { label: 'Sunrise', arabic: 'الشروق' },
  dhuhr: { label: 'Zuhr', arabic: 'الظهر' },
  asr: { label: 'Asr', arabic: 'العصر' },
  maghrib: { label: 'Maghrib', arabic: 'المغرب' },
  isha: { label: 'Isha', arabic: 'العشاء' },
};

const KEYS: PrayerKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const minutes = (n: number) => n * 60_000;
/** Slack for differences between the masjid's calculation method and ours. */
const WINDOW_TOLERANCE = minutes(5);
const weekday = ({ y, m, d }: Ymd) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function shortDate({ y, m, d }: Ymd): string {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, d),
  );
}

@Injectable({ providedIn: 'root' })
export class PrayerStore {
  private readonly clock = inject(Clock);
  private readonly data = inject(MasjidData);

  readonly masjidName = computed(() => this.data.config().masjid.name);
  readonly location = computed<PrayerLocation>(() => {
    const m = this.data.config().masjid;
    return { name: m.city, region: m.region, lat: m.latitude, lng: m.longitude, timeZone: m.timeZone };
  });
  /** Astronomical method, used for sunrise/sunset and for dates the schedule doesn't cover. */
  readonly method = signal(ISNA);
  readonly offsets = computed(() => this.data.config().adhanMinutesBeforeIqamah);
  readonly dataSource = this.data.source;
  readonly now = this.clock.now;

  readonly todayYmd = computed(() => zonedYmd(this.now(), this.location().timeZone), { equal: sameYmd });
  readonly midnight = computed(() => zonedMidnight(this.todayYmd(), this.location().timeZone));
  readonly minuteOfDay = computed(() => Math.floor((this.now().getTime() - this.midnight().getTime()) / 60_000));

  /** Sun times (astronomical) — drive the sky, sunrise and Maghrib. */
  readonly today = computed(() => this.sunTimes(this.todayYmd()));
  private readonly yesterday = computed(() => this.sunTimes(addDays(this.todayYmd(), -1)));
  private readonly tomorrow = computed(() => this.sunTimes(addDays(this.todayYmd(), 1)));

  /** Masjid schedule: iqamah from the published file, adhan = iqamah − configured minutes. */
  readonly todaySchedule = computed(() => this.scheduleFor(this.todayYmd()));
  private readonly yesterdaySchedule = computed(() => this.scheduleFor(addDays(this.todayYmd(), -1)));
  private readonly tomorrowSchedule = computed(() => this.scheduleFor(addDays(this.todayYmd(), 1)));

  readonly prayers = computed(() => this.todaySchedule().rows);

  /** Iqamah times change on Sundays, so "next week" is the schedule starting next Sunday. */
  readonly nextWeekYmd = computed(() => addDays(this.todayYmd(), 7 - weekday(this.todayYmd())));
  readonly nextWeekPrayers = computed(() => this.scheduleFor(this.nextWeekYmd()).rows);
  readonly nextWeekLabel = computed(() => `from ${shortDate(this.nextWeekYmd())}`);

  readonly next = computed<PrayerRow>(() => {
    const now = this.now().getTime();
    const upcoming = this.prayers().find((p) => p.key !== 'sunrise' && p.adhan.getTime() > now);
    return upcoming ?? this.tomorrowSchedule().rows[0];
  });

  /** The prayer whose time is currently running (none between sunrise and dhuhr). */
  readonly currentKey = computed<PrayerKey | null>(() => {
    const now = this.now().getTime();
    const passed = this.prayers().filter((p) => p.adhan.getTime() <= now);
    const last = passed.at(-1);
    if (!last) return 'isha';
    return last.key === 'sunrise' ? null : last.key;
  });

  /**
   * What the countdown is counting to: between a prayer's adhan and its iqamah it counts
   * down to that iqamah; otherwise to the next prayer's adhan.
   */
  readonly countdownTarget = computed<{ prayer: PrayerRow; kind: 'adhan' | 'iqamah'; at: Date }>(() => {
    const now = this.now().getTime();
    const awaiting = this.prayers().find((p) => p.iqamah && p.adhan.getTime() <= now && now < p.iqamah.getTime());
    if (awaiting?.iqamah) return { prayer: awaiting, kind: 'iqamah', at: awaiting.iqamah };
    const next = this.next();
    return { prayer: next, kind: 'adhan', at: next.adhan };
  });

  readonly countdown = computed(() => {
    const ms = Math.max(0, this.countdownTarget().at.getTime() - this.now().getTime());
    const s = Math.floor(ms / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  });

  /**
   * What the sky arc currently represents: the sun's path (sunrise → maghrib, with
   * Dhuhr and Asr on it) or the moon's path (maghrib → sunrise, with Isha and Fajr).
   */
  readonly arc = computed<SkyArc>(() => {
    const now = this.now().getTime();
    const sun = this.today();
    const adhan = (rows: PrayerRow[], key: PrayerKey) => rows.find((r) => r.key === key)!.adhan;
    if (now >= sun.sunrise.getTime() && now <= sun.maghrib.getTime()) {
      const rows = this.prayers();
      return {
        night: false,
        start: { key: 'sunrise', label: 'Sunrise', time: sun.sunrise },
        end: { key: 'maghrib', label: 'Sunset', time: sun.maghrib },
        markers: [
          { key: 'dhuhr', label: META.dhuhr.label, time: adhan(rows, 'dhuhr') },
          { key: 'asr', label: META.asr.label, time: adhan(rows, 'asr') },
        ],
      };
    }
    const afterSunset = now > sun.maghrib.getTime();
    const [eveningSun, morningSun] = afterSunset ? [sun, this.tomorrow()] : [this.yesterday(), sun];
    const [evening, morning] = afterSunset
      ? [this.prayers(), this.tomorrowSchedule().rows]
      : [this.yesterdaySchedule().rows, this.prayers()];
    return {
      night: true,
      start: { key: 'maghrib', label: 'Sunset', time: eveningSun.maghrib },
      end: { key: 'sunrise', label: 'Sunrise', time: morningSun.sunrise },
      markers: [
        { key: 'isha', label: META.isha.label, time: adhan(evening, 'isha') },
        { key: 'fajr', label: META.fajr.label, time: adhan(morning, 'fajr') },
      ],
    };
  });

  readonly sky = computed(() =>
    skyState(this.now(), this.location(), this.yesterday(), this.today(), this.tomorrow()),
  );

  readonly gregorianDate = computed(() =>
    new Intl.DateTimeFormat('en-CA', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: this.location().timeZone,
    }).format(this.now()),
  );

  readonly hijriDate = computed(() =>
    new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: this.location().timeZone,
    }).format(this.now()),
  );

  // ----- Monthly timetable -----
  private readonly monthOffset = signal(0);

  readonly month = computed(() => {
    const { y, m } = this.todayYmd();
    const idx = y * 12 + (m - 1) + this.monthOffset();
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  });

  readonly monthLabel = computed(() => {
    const { y, m } = this.month();
    return new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      Date.UTC(y, m - 1, 1),
    );
  });

  readonly monthRows = computed<MonthRow[]>(() => {
    const { y, m } = this.month();
    const today = this.todayYmd();
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => {
      const ymd = { y, m, d: i + 1 };
      const dow = weekday(ymd);
      return { ...this.scheduleFor(ymd), weekday: WEEKDAYS[dow], isToday: sameYmd(ymd, today), isFriday: dow === 5 };
    });
  });

  shiftMonth(delta: number): void {
    this.monthOffset.update((o) => (delta === 0 ? 0 : o + delta));
  }

  // ----- Jumu'ah -----
  /** Today if it's Friday, otherwise the coming Friday. */
  readonly jumuahYmd = computed(() => addDays(this.todayYmd(), (5 - weekday(this.todayYmd()) + 7) % 7));
  readonly jumuahLabel = computed(() => shortDate(this.jumuahYmd()));
  readonly isFriday = computed(() => weekday(this.todayYmd()) === 5);

  readonly jumuah = computed<JumuahRow[]>(() => {
    const ymd = this.jumuahYmd();
    const tz = this.location().timeZone;
    const before = minutes(this.offsets().jumuah);
    const now = this.now().getTime();
    let nextFound = false;
    return this.data.jumuah().map((slot) => {
      const iqamah = zonedDateTime(ymd, slot.iqamah, tz);
      let state: JumuahRow['state'] = 'upcoming';
      if (iqamah.getTime() <= now) state = 'done';
      else if (!nextFound) {
        state = 'next';
        nextFound = true;
      }
      return {
        name: slot.name,
        location: slot.location,
        khutbah: slot.khutbah === null ? null : zonedDateTime(ymd, slot.khutbah, tz),
        iqamah,
        adhan: new Date(iqamah.getTime() - before),
        state,
      };
    });
  });

  // ----- Building blocks -----
  private sunTimes(ymd: Ymd): DayTimes {
    return computeDay(ymd, this.location(), this.method());
  }

  /** Prayer rows for a date from the published schedule, falling back to calculated adhan times. */
  scheduleFor(ymd: Ymd): DaySchedule {
    const sun = this.sunTimes(ymd);
    const day = this.data.schedule().get(ymdKey(ymd));
    if (!day) {
      return {
        ymd,
        published: false,
        rows: KEYS.map((key) => ({ key, ...META[key], adhan: sun[key], iqamah: null })),
      };
    }
    const tz = this.location().timeZone;
    const offsets = this.offsets();
    const at = (mins: number) => zonedDateTime(ymd, mins, tz);
    const iqamah: Record<Exclude<PrayerKey, 'sunrise'>, Date> = {
      fajr: at(day.fajr),
      dhuhr: at(day.dhuhr),
      asr: at(day.asr),
      maghrib: maghribIqamah(day, sun, at),
      isha: at(day.isha),
    };
    const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    // Earliest moment each prayer can begin. Fajr uses 18° (the earliest common convention);
    // Isha isn't checked because high-latitude masjids legitimately use different Isha rules.
    const earliest: Partial<Record<PrayerKey, Date>> = {
      fajr: computeDay(ymd, this.location(), { ...this.method(), fajrAngle: 18 }).fajr,
      dhuhr: sun.dhuhr,
      asr: sun.asr,
    };
    const problem = (key: Exclude<PrayerKey, 'sunrise'>): string | undefined => {
      const t = iqamah[key].getTime();
      const begins = earliest[key];
      if (begins && t < begins.getTime() - WINDOW_TOLERANCE) {
        return `${META[key].label} iqamah ${clock.format(iqamah[key])} is before ${META[key].label} begins (${clock.format(begins)})`;
      }
      if (key === 'fajr' && t > sun.sunrise.getTime()) {
        return `Fajr iqamah ${clock.format(iqamah.fajr)} is after sunrise (${clock.format(sun.sunrise)})`;
      }
      return undefined;
    };
    return {
      ymd,
      published: true,
      rows: KEYS.map((key) =>
        key === 'sunrise'
          ? { key, ...META[key], adhan: sun.sunrise, iqamah: null }
          : {
              key,
              ...META[key],
              iqamah: iqamah[key],
              adhan: new Date(iqamah[key].getTime() - minutes(offsets[key])),
              problem: problem(key),
            },
      ),
    };
  }
}

function maghribIqamah(day: IqamahDay, sun: DayTimes, at: (mins: number) => Date): Date {
  return 'afterSunset' in day.maghrib
    ? new Date(sun.maghrib.getTime() + minutes(day.maghrib.afterSunset))
    : at(day.maghrib.at);
}
