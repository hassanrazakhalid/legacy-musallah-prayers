import { PRAYER_KEYS, SalahKey } from './firestore-schema';

/**
 * The prayer-times calendar people subscribe to. GitHub Pages only serves fixed files, so the
 * generator (scripts/calendar) publishes one file for every combination of reminder choices
 * (4 choices ^ 5 prayers = 1024 files) and the reminder panel links to the matching one.
 * Changing these choices changes the file names: existing subscriptions would stop updating.
 */
export const REMINDER_CHOICES = [0, 10, 15, 30] as const;
export type ReminderMinutes = (typeof REMINDER_CHOICES)[number];
/** Minutes before each prayer's iqamah to alert; 0 = no alert. */
export type Reminders = Record<SalahKey, ReminderMinutes>;

export const NO_REMINDERS: Reminders = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };

/** Folder (under the site root) that holds the calendar files. */
export const CALENDAR_DIR = 'calendar';

/** `calendar/prayer-times-15-10-0-0-30.ics`: minutes for Fajr, Zuhr, Asr, Maghrib, Isha. */
export function calendarPath(reminders: Reminders): string {
  return `${CALENDAR_DIR}/prayer-times-${PRAYER_KEYS.map((k) => reminders[k]).join('-')}.ics`;
}

/** Every combination of reminder choices, one per published file. */
export function allReminderCombos(): Reminders[] {
  return PRAYER_KEYS.reduce<Reminders[]>(
    (combos, key) => combos.flatMap((r) => REMINDER_CHOICES.map((m) => ({ ...r, [key]: m }))),
    [{ ...NO_REMINDERS }],
  );
}

export function isReminders(value: unknown): value is Reminders {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return PRAYER_KEYS.every((k) => (REMINDER_CHOICES as readonly unknown[]).includes(r[k]));
}
