/** Calendar date in a specific time zone (month is 1-based). */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(ts: number, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(ts);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

export function zonedYmd(date: Date, timeZone: string): Ymd {
  const { y, m, d } = zonedParts(date.getTime(), timeZone);
  return { y, m, d };
}

/** Offset of `timeZone` from UTC at instant `ts`, in ms. */
function tzOffsetMs(ts: number, timeZone: string): number {
  const p = zonedParts(ts, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}

/** The instant of local midnight for `ymd` in `timeZone`. */
export function zonedMidnight(ymd: Ymd, timeZone: string): Date {
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  return new Date(guess - tzOffsetMs(guess, timeZone));
}

export function addDays(ymd: Ymd, days: number): Ymd {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const sameYmd = (a: Ymd, b: Ymd) => a.y === b.y && a.m === b.m && a.d === b.d;

/** The instant at `minutes` past local midnight on `ymd` in `timeZone` (correct across DST changes). */
export function zonedDateTime(ymd: Ymd, minutes: number, timeZone: string): Date {
  const wall = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + minutes * 60_000;
  let t = wall - tzOffsetMs(wall, timeZone);
  t = wall - tzOffsetMs(t, timeZone);
  return new Date(t);
}

export const ymdKey = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
