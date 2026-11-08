import { computed, inject, Injectable, signal } from '@angular/core';
import { Clock } from './clock';
import { PRAYER_KEYS, SalahKey } from './firestore-schema';
import { MasjidData, SalahTimes } from './masjid-data';
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

  /**
   * The next date the iqamah schedule changes. From the admin page: the earliest next-week date still
   * ahead. From the CSV: the next date whose rules differ ("Sunset+ 10 min" counts as unchanged even
   * though its clock time drifts daily). Falls back to next Sunday when no change is ahead.
   */
  readonly nextChangeYmd = computed(() => {
    const today = this.todayYmd();
    const todayKey = ymdKey(today);
    const weekly = this.data.weekly();
    if (weekly) {
      const ahead = [...weekly.values()]
        .map((p) => p.next?.effectiveDate)
        .filter((d): d is string => !!d && d > todayKey)
        .sort();
      if (ahead.length) {
        const [y, m, d] = ahead[0].split('-').map(Number);
        return { y, m, d };
      }
    } else {
      const todayRules = JSON.stringify(this.rulesFor(today));
      for (let i = 1; i <= 366; i++) {
        const day = this.rulesFor(addDays(today, i));
        if (!day) break;
        if (JSON.stringify(day) !== todayRules) return addDays(today, i);
      }
    }
    return addDays(today, 7 - weekday(today));
  });
  readonly nextChangePrayers = computed(() => this.scheduleFor(this.nextChangeYmd()).rows);
  readonly nextChangeLabel = computed(() => shortDate(this.nextChangeYmd()));
  /** Prayers whose published iqamah differs between today and the next change. */
  readonly changedPrayers = computed(() => {
    const today = this.rulesFor(this.todayYmd());
    const later = this.rulesFor(this.nextChangeYmd());
    return new Set<PrayerKey>(
      PRAYER_KEYS.filter((k) => JSON.stringify(today?.[k] ?? null) !== JSON.stringify(later?.[k] ?? null)),
    );
  });

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
   * The prayer day for the sky arc: today's six times in order, plus the Isha before
   * and the Fajr after, so the marker can travel through the night between them.
   */
  readonly prayerCycle = computed(() => ({
    today: this.prayers(),
    prevIsha: this.yesterdaySchedule().rows.at(-1)!.adhan,
    nextFajr: this.tomorrowSchedule().rows[0].adhan,
  }));

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
        adhan: slot.adhan === null ? new Date(iqamah.getTime() - before) : zonedDateTime(ymd, slot.adhan, tz),
        state,
      };
    });
  });

  // ----- Building blocks -----
  private sunTimes(ymd: Ymd): DayTimes {
    return computeDay(ymd, this.location(), this.method());
  }

  /**
   * Sunrise and sunset for a date: iqamah.ca's published times when it has the date, otherwise
   * calculated. Sunset is the Maghrib adhan.
   */
  private publishedSun(ymd: Ymd, calc: DayTimes): { sunrise: Date; sunset: Date } {
    const day = this.data.sun().get(ymdKey(ymd));
    if (!day) return { sunrise: calc.sunrise, sunset: calc.maghrib };
    const tz = this.location().timeZone;
    return { sunrise: zonedDateTime(ymd, day.sunrise, tz), sunset: zonedDateTime(ymd, day.sunset, tz) };
  }

  /**
   * The admin page's times for a date: next week's from its effective date, otherwise this week's.
   * Null when the admin page hasn't published times (the CSV schedule is used instead).
   */
  private weeklyFor(ymd: Ymd): Record<SalahKey, SalahTimes> | null {
    const weekly = this.data.weekly();
    if (!weekly) return null;
    const key = ymdKey(ymd);
    const pick = (k: SalahKey) => {
      const p = weekly.get(k)!;
      return p.next && p.next.effectiveDate <= key ? { adhan: p.next.adhan, iqamah: p.next.iqamah } : p.current;
    };
    return Object.fromEntries(PRAYER_KEYS.map((k) => [k, pick(k)])) as Record<SalahKey, SalahTimes>;
  }

  /** What defines each prayer's times on a date, for spotting schedule changes. */
  private rulesFor(ymd: Ymd): Record<SalahKey, unknown> | null {
    return this.weeklyFor(ymd) ?? this.data.schedule().get(ymdKey(ymd)) ?? null;
  }

  /** Adhan and iqamah for a date: the admin page's times, else the CSV (adhan = iqamah − minutes). */
  private salahFor(ymd: Ymd, sunset: Date): Record<SalahKey, { adhan: Date; iqamah: Date }> | null {
    const tz = this.location().timeZone;
    const at = (mins: number) => zonedDateTime(ymd, mins, tz);
    const weekly = this.weeklyFor(ymd);
    if (weekly) {
      const entry = (k: SalahKey) => [k, { adhan: at(weekly[k].adhan), iqamah: at(weekly[k].iqamah) }];
      return Object.fromEntries(PRAYER_KEYS.map(entry));
    }
    const day = this.data.schedule().get(ymdKey(ymd));
    if (!day) return null;
    const offsets = this.offsets();
    const iqamah: Record<SalahKey, Date> = {
      fajr: at(day.fajr),
      dhuhr: at(day.dhuhr),
      asr: at(day.asr),
      maghrib: 'afterSunset' in day.maghrib ? new Date(sunset.getTime() + minutes(day.maghrib.afterSunset)) : at(day.maghrib.at),
      isha: at(day.isha),
    };
    const entry = (k: SalahKey) => [k, { iqamah: iqamah[k], adhan: new Date(iqamah[k].getTime() - minutes(offsets[k])) }];
    return Object.fromEntries(PRAYER_KEYS.map(entry));
  }

  /** Prayer rows for a date from the published schedule, falling back to calculated adhan times. */
  scheduleFor(ymd: Ymd): DaySchedule {
    const calc = this.sunTimes(ymd);
    const { sunrise, sunset } = this.publishedSun(ymd, calc);
    const salah = this.salahFor(ymd, sunset);
    if (!salah) {
      const sun: DayTimes = { ...calc, sunrise, maghrib: sunset };
      return {
        ymd,
        published: false,
        rows: KEYS.map((key) => ({ key, ...META[key], adhan: sun[key], iqamah: null })),
      };
    }
    const tz = this.location().timeZone;
    const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    // Earliest moment each prayer can begin. Fajr uses 18° (the earliest common convention);
    // Isha isn't checked because high-latitude masjids legitimately use different Isha rules.
    const earliest: Partial<Record<PrayerKey, Date>> = {
      fajr: computeDay(ymd, this.location(), { ...this.method(), fajrAngle: 18 }).fajr,
      dhuhr: calc.dhuhr,
      asr: calc.asr,
    };
    const problem = (key: SalahKey): string | undefined => {
      const { adhan, iqamah } = salah[key];
      const t = iqamah.getTime();
      if (adhan.getTime() > t) {
        return `${META[key].label} adhan ${clock.format(adhan)} is after its iqamah ${clock.format(iqamah)}`;
      }
      const begins = earliest[key];
      if (begins && t < begins.getTime() - WINDOW_TOLERANCE) {
        return `${META[key].label} iqamah ${clock.format(iqamah)} is before ${META[key].label} begins (${clock.format(begins)})`;
      }
      if (key === 'fajr' && t > sunrise.getTime()) {
        return `Fajr iqamah ${clock.format(iqamah)} is after sunrise (${clock.format(sunrise)})`;
      }
      return undefined;
    };
    return {
      ymd,
      published: true,
      rows: KEYS.map((key) =>
        key === 'sunrise'
          ? { key, ...META[key], adhan: sunrise, iqamah: null }
          : { key, ...META[key], ...salah[key], problem: problem(key) },
      ),
    };
  }
}
