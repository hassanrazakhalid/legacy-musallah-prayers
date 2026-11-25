/**
 * Builds the subscribable prayer-times calendars (.ics) published with the site.
 *
 *   npm run calendar -- --out <site root, e.g. dist/frontend/browser> [--days 14]
 *
 * Reads the same data as the display: Firestore (the admin page's times, public read), else the
 * CSV schedule in public/data; sunrise/sunset from iqamah.ca (bundled snapshot as fallback).
 * Writes one .ics per reminder combination (see calendar-presets.ts) plus version.json, whose hash
 * changes only when the events do, so the deploy workflow can skip unchanged runs.
 * Exits non-zero if Firestore can't be reached, so a failed run never publishes stale times.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allReminderCombos, CALENDAR_DIR, calendarPath, Reminders } from '../../src/app/core/calendar-presets';
import { JUMUAH, PRAYER_KEYS, PRAYER_NAMES, PRAYERS, SalahKey } from '../../src/app/core/firestore-schema';
import {
  DocData,
  IqamahDay,
  JumuahSlot,
  mergeConfig,
  parseFirestoreJumuah,
  parseJumuah,
  parseSchedule,
  parseSun,
  parseWeekly,
  RawSchedule,
} from '../../src/app/core/masjid-parse';
import { computeDay, ISNA } from '../../src/app/core/prayer-calc';
import { publishedSalahOn, publishedSun, ScheduleInputs } from '../../src/app/core/salah-times';
import { addDays, Ymd, ymdKey, zonedDateTime, zonedMidnight, zonedYmd } from '../../src/app/core/zoned-time';

const FIRESTORE_PROJECT = 'legacy-musallah';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/`;
const FETCH_TIMEOUT_MS = 15_000;
const CALENDAR_NAME = 'Legacy Musallah Prayer Times';
/** How often calendar apps that honour it (Apple, Outlook) should re-fetch. */
const REFRESH = 'PT3H';
/** How long each prayer's event lasts from its iqamah. */
const PRAYER_MINUTES = 15;

interface CalEvent {
  uid: string;
  start: Date;
  end: Date;
  /** Reminders count back from the iqamah (each event starts at its iqamah). */
  iqamah: Date;
  summary: string;
  description: string;
  /** The prayer whose reminder applies; Jumu'ah events carry none. */
  salah?: SalahKey;
  /** "7:50 AM", for the alert text. */
  iqamahLabel: string;
  adhanLabel: string;
}

// ----- Arguments -----

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i > 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

const outDir = arg('out');
const dataDir = arg('data', 'public/data');
const days = Number(arg('days', '14'));

// ----- Loading -----

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Firestore REST values ({ stringValue: "05:40" }, { mapValue: { fields } }, ...) as plain data. */
function fromFirestore(v: any): unknown {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fieldsOf(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFirestore);
  return null;
}

const fieldsOf = (fields: Record<string, unknown> = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFirestore(v)]));

async function firestoreCollection(name: string): Promise<DocData[]> {
  const body = JSON.parse(await fetchText(`${FIRESTORE_URL}${name}?pageSize=300`));
  return (body.documents ?? []).map((d: { name: string; fields?: Record<string, unknown> }) => ({
    id: d.name.split('/').pop()!,
    data: fieldsOf(d.fields),
  }));
}

/** iqamah.ca's `const SALAH_SCHEDULE = { "2026-01-01": { fajr: "8:10 AM", ... }, ... }`, read without running it. */
function parseScheduleScript(text: string): RawSchedule {
  const out: RawSchedule = {};
  for (const [, date, body] of text.matchAll(/"(\d{4}-\d{2}-\d{2})"\s*:\s*\{([^}]*)\}/g)) {
    out[date] = Object.fromEntries([...body.matchAll(/(\w+)\s*:\s*"([^"]*)"/g)].map(([, k, v]) => [k, v]));
  }
  return out;
}

async function loadSalahScript(url: string): Promise<RawSchedule> {
  try {
    const parsed = parseScheduleScript(await fetchText(url));
    if (Object.keys(parsed).length) return parsed;
    console.warn(`${url}: no dates found, using the bundled copy`);
  } catch (e) {
    console.warn(`${url}: ${e}, using the bundled copy`);
  }
  return parseScheduleScript(readFileSync(join(dataDir, 'iqamah.ca/salahschedule.js'), 'utf8'));
}

// ----- Events -----

function buildEvents(inputs: ScheduleInputs, jumuah: JumuahSlot[], masjid: string, from: Ymd): CalEvent[] {
  const tz = inputs.location.timeZone;
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const t = (d: Date) => clock.format(d);
  const events: CalEvent[] = [];

  for (let i = 0; i < days; i++) {
    const ymd = addDays(from, i);
    const date = ymdKey(ymd);
    const salah = publishedSalahOn(inputs, ymd);
    if (!salah) continue; // No published schedule for this date: leave it out rather than guess.

    // Each event is the congregational prayer itself: it starts at the iqamah and lasts PRAYER_MINUTES.
    // The adhan goes in the title, so the reminder shows it too; when the prayer's time ends goes in the notes.
    const { sunrise } = publishedSun(inputs, ymd, computeDay(ymd, inputs.location, inputs.method));
    const ends: Record<SalahKey, { at: Date; label: string }> = {
      fajr: { at: sunrise, label: 'sunrise' },
      dhuhr: { at: salah.asr.adhan, label: 'Asr' },
      asr: { at: salah.maghrib.adhan, label: 'Maghrib' },
      maghrib: { at: salah.isha.adhan, label: 'Isha' },
      isha: { at: zonedMidnight(addDays(ymd, 1), tz), label: 'midnight' },
    };
    for (const key of PRAYER_KEYS) {
      const { adhan, iqamah } = salah[key];
      const until = key === 'isha' ? '' : `\n${PRAYER_NAMES[key]} time ends ${t(ends[key].at)} (${ends[key].label})`;
      events.push({
        uid: `${date}-${key}`,
        start: iqamah,
        end: new Date(iqamah.getTime() + PRAYER_MINUTES * 60_000),
        iqamah,
        summary: `${PRAYER_NAMES[key]} · Adhan ${t(adhan)}`,
        description: `Adhan ${t(adhan)} · Iqamah ${t(iqamah)}${until}\n${masjid}`,
        salah: key,
        iqamahLabel: t(iqamah),
        adhanLabel: t(adhan),
      });
    }

    if (new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() === 5) {
      jumuah.forEach((slot, n) => {
        const iqamah = zonedDateTime(ymd, slot.iqamah, tz);
        const adhan =
          slot.adhan === null
            ? new Date(iqamah.getTime() - inputs.offsets.jumuah * 60_000)
            : zonedDateTime(ymd, slot.adhan, tz);
        const khutbah = slot.khutbah === null ? '' : `Khutbah ${t(zonedDateTime(ymd, slot.khutbah, tz))} · `;
        events.push({
          uid: `${date}-jumuah-${n + 1}`,
          start: iqamah,
          end: new Date(iqamah.getTime() + PRAYER_MINUTES * 60_000),
          iqamah,
          summary: `${slot.name} · Adhan ${t(adhan)}`,
          description: `Adhan ${t(adhan)} · ${khutbah}Iqamah ${t(iqamah)}\n${slot.location || masjid}`,
          iqamahLabel: t(iqamah),
          adhanLabel: t(adhan),
        });
      });
    }
  }
  return events;
}

// ----- iCalendar -----

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Alert `minutes` before the iqamah, written relative to the event start. */
function alarm(event: CalEvent, minutes: number, iqamah: string, adhan: string): string[] {
  const offset = Math.round((event.iqamah.getTime() - event.start.getTime()) / 60_000) - minutes;
  const trigger = offset < 0 ? `-PT${-offset}M` : `PT${offset}M`;
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`${PRAYER_NAMES[event.salah!]} · Adhan ${adhan} · Iqamah ${iqamah} (in ${minutes} minutes)`)}`,
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ];
}

function buildIcs(events: CalEvent[], reminders: Reminders, location: string, stamp: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Legacy Musallah//Prayer Times//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-CALDESC:${escapeText('Each prayer and Jumu\'ah at its iqamah, with the adhan time in the title. Updates automatically.')}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@legacy-musallah-prayers`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `LOCATION:${escapeText(location)}`,
      'TRANSP:TRANSPARENT',
    );
    const minutes = e.salah ? reminders[e.salah] : 0;
    if (minutes) lines.push(...alarm(e, minutes, e.iqamahLabel, e.adhanLabel));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ----- Main -----

async function main() {
  const errors: string[] = [];
  const config = mergeConfig(JSON.parse(readFileSync(join(dataDir, 'prayer-config.json'), 'utf8')));

  const schedule = new Map<string, IqamahDay>();
  for (const file of config.iqamahSchedules) {
    for (const [date, day] of parseSchedule(readFileSync(join(dataDir, file), 'utf8'), file, errors)) {
      schedule.set(date, day);
    }
  }
  const fileJumuah = parseJumuah(readFileSync(join(dataDir, config.jumuahFile), 'utf8'), config.jumuahFile, errors);
  const sun = parseSun(await loadSalahScript(config.salahScheduleUrl), errors);

  // Network or permission errors throw: better no update than times that ignore the admin page.
  const [prayerDocs, jumuahDocs] = await Promise.all([firestoreCollection(PRAYERS), firestoreCollection(JUMUAH)]);
  const weekly = parseWeekly(prayerDocs);
  // Same rule as the display: once the admin page has published times, Jumu'ah comes from Firestore too.
  const jumuah = weekly ? parseFirestoreJumuah(jumuahDocs) : fileJumuah;
  errors.forEach((e) => console.warn(e));

  const { masjid } = config;
  const inputs: ScheduleInputs = {
    location: { name: masjid.city, region: masjid.region, lat: masjid.latitude, lng: masjid.longitude, timeZone: masjid.timeZone },
    method: ISNA,
    offsets: config.adhanMinutesBeforeIqamah,
    weekly,
    schedule,
    sun,
  };
  const today = zonedYmd(new Date(), masjid.timeZone);
  const events = buildEvents(inputs, jumuah, masjid.name, today);
  if (!events.length) throw new Error(`no published times for the ${days} days from ${ymdKey(today)}`);

  const hash = createHash('sha256')
    .update(JSON.stringify(events))
    .digest('hex')
    .slice(0, 16);
  const stamp = icsDate(new Date());
  const location = `${masjid.name}, ${masjid.city}, ${masjid.region}`;

  const combos = allReminderCombos();
  for (const reminders of combos) {
    const file = join(outDir, calendarPath(reminders));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buildIcs(events, reminders, location, stamp));
  }
  const version = {
    hash,
    generatedAt: new Date().toISOString(),
    from: ymdKey(today),
    days,
    source: weekly ? 'firestore' : 'files',
    events: events.length,
  };
  writeFileSync(join(outDir, CALENDAR_DIR, 'version.json'), JSON.stringify(version, null, 2) + '\n');
  console.log(`Wrote ${combos.length} calendars (${events.length} events each) to ${join(outDir, CALENDAR_DIR)}`, version);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
