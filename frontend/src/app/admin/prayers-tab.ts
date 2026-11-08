import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { adminDb as db } from './admin-firebase';
import {
  Adjustment,
  hhmmToMinutes,
  isAdjustment,
  isHhmm,
  minutesToHhmm,
  PRAYER_KEYS,
  PRAYER_NAMES,
  PrayerDoc,
  PrayerSchedule,
  PRAYERS,
  SalahKey,
  timesOn,
} from '../core/firestore-schema';
import { MasjidData } from '../core/masjid-data';
import { addDays, ymdKey } from '../core/zoned-time';
import { AdminAuth, errorMessage } from './admin-auth';
import { comingSunday, prayersFromFiles, todayKey } from './from-files';
import { TimeField } from './time-field';

interface Row {
  key: SalahKey;
  adhan: string;
  iqamah: string;
  nextAdhan: string;
  nextIqamah: string;
  /** "+10", "-15" or '' for each date in Form.changeDates. */
  changes: string[];
}
type TimeKey = 'adhan' | 'iqamah' | 'nextAdhan' | 'nextIqamah';

interface Form {
  rows: Row[];
  /** When next week's times take effect (YYYY-MM-DD). */
  effectiveDate: string;
  /** Dates of the +/- columns, in column order. */
  changeDates: string[];
}

const emptyRows = (): Row[] =>
  PRAYER_KEYS.map((key) => ({ key, adhan: '', iqamah: '', nextAdhan: '', nextIqamah: '', changes: [] }));

/** "+10", "-15", "10" → minutes; '' → 0; anything else → null. */
function parseDelta(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  if (!t) return 0;
  if (!/^[+-]?\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= 720 ? n : null;
}

const formatDelta = (n: number) => (n > 0 ? `+${n}` : String(n));

/** 300 or "05:00" → "5:00 AM". */
function clock(t: string | number): string {
  const mins = typeof t === 'number' ? t : hhmmToMinutes(t);
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, d),
  );
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return ymdKey(addDays({ y, m, d }, days));
}

/** A form row as a schedule, or null while its times aren't valid. */
function toSchedule(r: Row, effectiveDate: string, changeDates: string[]): PrayerSchedule | null {
  if (!isHhmm(r.adhan) || !isHhmm(r.iqamah)) return null;
  const hasNext = isHhmm(r.nextAdhan) && isHhmm(r.nextIqamah) && !!effectiveDate;
  const adjustments: Adjustment[] = [];
  changeDates.forEach((date, i) => {
    const minutes = parseDelta(r.changes[i] ?? '');
    if (date && minutes) adjustments.push({ date, minutes });
  });
  return {
    current: { adhan: hhmmToMinutes(r.adhan), iqamah: hhmmToMinutes(r.iqamah) },
    next: hasNext
      ? { adhan: hhmmToMinutes(r.nextAdhan), iqamah: hhmmToMinutes(r.nextIqamah), effectiveDate }
      : null,
    adjustments,
  };
}

/**
 * The five daily prayers: this week's adhan/iqamah, next week's (from a date), and any number of
 * dated "+10 / -15 minutes" columns. The display works out each day's times from these on its own
 * (no scheduled job); when a date has passed, this page folds it into "this week" on load.
 */
@Component({
  selector: 'app-prayers-tab',
  imports: [TimeField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="toolbar">
      <button type="button" class="ghost" (click)="fillFromFiles()">Fill from current files</button>
      <button type="button" class="ghost" (click)="copyToNext()">Copy this week → next week</button>
      <button type="button" class="ghost" (click)="promote()" [disabled]="!hasNext()">
        Promote next week → this week
      </button>
      <span class="spacer"></span>
      @if (dirty()) {
        <span class="unsaved">Unsaved changes</span>
        <button type="button" class="ghost" (click)="revert()">Revert</button>
      }
      <button type="button" class="primary" (click)="save()" [disabled]="!dirty() || errors().length || saving()">
        {{ saving() ? 'Saving…' : 'Save' }}
      </button>
    </div>

    @if (notice()) {
      <p class="notice">{{ notice() }}</p>
    }
    @if (empty()) {
      <p class="notice">
        Firebase has no prayer times yet, so the display is still using the CSV files. Use
        <strong>Fill from current files</strong> (or type the times) and press <strong>Save</strong>.
      </p>
    }

    <div class="scroll">
      <table class="grid">
        <thead>
          <tr class="group">
            <th rowspan="2" class="name">Prayer</th>
            <th colspan="2">This week</th>
            <th colspan="2" class="next-col">
              Next week, from
              <input
                type="date"
                [value]="form().effectiveDate"
                [min]="today"
                (input)="setDate($any($event.target).value)"
                aria-label="Next week starts on"
              />
            </th>
            @for (d of form().changeDates; track $index; let c = $index) {
              <th rowspan="2" class="change-col">
                <div class="change-head">
                  <span>± min from</span>
                  <button type="button" class="icon danger" (click)="removeChange(c)" aria-label="Remove this date">✕</button>
                </div>
                <input
                  type="date"
                  [value]="d"
                  [min]="today"
                  [class.invalid]="badDates().has(c)"
                  (input)="setChangeDate(c, $any($event.target).value)"
                  [attr.aria-label]="'Change ' + (c + 1) + ' date'"
                />
              </th>
            }
            <th rowspan="2" class="add-col">
              <button type="button" class="ghost" (click)="addChange()" title="Add a date with +/- minutes">+ Add date</button>
            </th>
          </tr>
          <tr>
            <th>Adhan</th>
            <th>Iqamah</th>
            <th class="next-col">Adhan</th>
            <th class="next-col">Iqamah</th>
          </tr>
        </thead>
        <tbody>
          @for (r of form().rows; track r.key; let i = $index) {
            <tr>
              <th class="name" scope="row">{{ names[r.key] }}</th>
              @for (f of fields; track f) {
                <td [class.next-col]="f.startsWith('next')" [class.changed]="isChanged(r, f)">
                  <app-time-field
                    [value]="r[f]"
                    (valueChange)="set(i, f, $event)"
                    [invalid]="invalid().has(r.key + f)"
                    [label]="names[r.key] + ' ' + labels[f]"
                    [defaultAmPm]="r.key === 'fajr' ? 'AM' : 'PM'"
                  />
                </td>
              }
              @for (d of form().changeDates; track $index; let c = $index) {
                <td class="change-col">
                  <input
                    type="text"
                    class="delta"
                    inputmode="numeric"
                    placeholder="±0"
                    [value]="r.changes[c] ?? ''"
                    [class.invalid]="invalid().has(r.key + 'change' + c)"
                    [class.filled]="!!r.changes[c]"
                    (change)="setChange(i, c, $any($event.target).value)"
                    [attr.aria-label]="names[r.key] + ' minutes to add on ' + d"
                  />
                  @if (preview()[i][c]; as p) {
                    <div class="preview" [title]="'Adhan ' + p.adhan + ' · Iqamah ' + p.iqamah">{{ p.iqamah }}</div>
                  }
                </td>
              }
              <td class="add-col"></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (errors().length) {
      <ul class="errors">
        @for (e of errors(); track e) {
          <li>{{ e }}</li>
        }
      </ul>
    }

    <p class="help">
      The display shows this week's times, then switches to next week's on {{ dateLabel() }}.
      Leave a prayer's next-week cells empty if it doesn't change. Highlighted cells differ from this week.
      <br />± columns: from that date, adhan and iqamah move by the minutes typed (e.g. <code>+10</code> or
      <code>-15</code>), on top of the times before it, and stay moved. The small time is the resulting iqamah.
      Next week's times are used as entered, so only ± dates on or after its start shift them.
      @if (updated()) {
        <br />Last saved {{ updated() }}.
      }
    </p>
  `,
  styles: `
    .change-col {
      background: rgba(140, 200, 255, 0.06);
      text-align: center;
      white-space: nowrap;
    }
    .change-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.25rem;
    }
    th.change-col input {
      display: block;
      width: 9.5rem;
      margin-top: 0.25rem;
      text-transform: none;
    }
    input.delta {
      width: 4.5rem;
      min-width: 0;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    input.delta.filled {
      border-color: #8cc8ff;
    }
    .preview {
      font-size: 0.75rem;
      opacity: 0.7;
      margin-top: 0.125rem;
    }
    .add-col {
      width: 1%;
      white-space: nowrap;
      vertical-align: middle;
    }
  `,
})
export class PrayersTab {
  private readonly auth = inject(AdminAuth);
  private readonly data = inject(MasjidData);

  protected readonly names = PRAYER_NAMES;
  protected readonly fields: TimeKey[] = ['adhan', 'iqamah', 'nextAdhan', 'nextIqamah'];
  protected readonly labels: Record<TimeKey, string> = {
    adhan: 'adhan this week',
    iqamah: 'iqamah this week',
    nextAdhan: 'adhan next week',
    nextIqamah: 'iqamah next week',
  };
  protected readonly today = todayKey(this.data);

  protected readonly form = signal<Form>({ rows: emptyRows(), effectiveDate: comingSunday(this.data), changeDates: [] });
  /** The form as last loaded from Firestore. */
  private readonly saved = signal<Form>(this.form());
  protected readonly empty = signal(false);
  protected readonly saving = signal(false);
  protected readonly notice = signal('');
  protected readonly updated = signal('');

  protected readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.saved()));
  protected readonly hasNext = computed(() => this.form().rows.some((r) => r.nextAdhan || r.nextIqamah));
  protected readonly dateLabel = computed(() => (this.form().effectiveDate ? longDate(this.form().effectiveDate) : '—'));

  /** Cells to outline red, keyed `${prayer}${field}` or `${prayer}change${column}`. */
  protected readonly invalid = computed(() => new Set(this.check().cells));
  protected readonly badDates = computed(() => new Set(this.check().badDates));
  protected readonly errors = computed(() => this.check().messages);

  /** For each row and ± column: the times in effect from that date, if the row is valid. */
  protected readonly preview = computed(() => {
    const { rows, effectiveDate, changeDates } = this.form();
    return rows.map((r) => {
      const schedule = toSchedule(r, effectiveDate, changeDates);
      return changeDates.map((d, c) => {
        if (!schedule || !d || !r.changes[c]) return null;
        const t = timesOn(schedule, d);
        return { adhan: clock(t.adhan), iqamah: clock(t.iqamah) };
      });
    });
  });

  private readonly check = computed(() => {
    const { rows, effectiveDate, changeDates } = this.form();
    const cells: string[] = [];
    const badDates: number[] = [];
    const messages: string[] = [];
    for (const r of rows) {
      const name = PRAYER_NAMES[r.key];
      for (const f of ['adhan', 'iqamah'] as const) {
        if (!isHhmm(r[f])) {
          cells.push(r.key + f);
          messages.push(`${name}: this week's ${f} is ${r[f] ? `not a valid time ("${r[f]}")` : 'required'}.`);
        }
      }
      if (isHhmm(r.adhan) && isHhmm(r.iqamah) && r.adhan > r.iqamah) {
        cells.push(r.key + 'adhan');
        messages.push(`${name}: adhan (${clock(r.adhan)}) is after iqamah (${clock(r.iqamah)}).`);
      }
      for (const f of ['nextAdhan', 'nextIqamah'] as const) {
        if (r[f] && !isHhmm(r[f])) {
          cells.push(r.key + f);
          messages.push(`${name}: "${r[f]}" is not a valid time.`);
        }
      }
      if (!!r.nextAdhan !== !!r.nextIqamah) {
        cells.push(r.key + (r.nextAdhan ? 'nextIqamah' : 'nextAdhan'));
        messages.push(`${name}: fill in both next-week times, or leave both empty.`);
      } else if (r.nextAdhan && r.nextAdhan > r.nextIqamah) {
        cells.push(r.key + 'nextAdhan');
        messages.push(`${name}: next week's adhan (${clock(r.nextAdhan)}) is after its iqamah (${clock(r.nextIqamah)}).`);
      }
      r.changes.forEach((v, c) => {
        if (parseDelta(v) === null) {
          cells.push(r.key + 'change' + c);
          messages.push(`${name}: "${v}" isn't a number of minutes (use e.g. +10 or -15, up to 720).`);
        }
      });
    }
    if (rows.some((r) => r.nextAdhan || r.nextIqamah)) {
      if (!effectiveDate) messages.push('Choose the date next week starts.');
      else if (effectiveDate < this.today) messages.push('The next-week date is in the past.');
    }
    changeDates.forEach((d, c) => {
      const used = rows.some((r) => r.changes[c]);
      if (!d) {
        if (used) (badDates.push(c), messages.push(`± column ${c + 1}: choose a date.`));
      } else if (d < this.today) {
        badDates.push(c);
        messages.push(`± column ${c + 1}: ${longDate(d)} is in the past.`);
      } else if (changeDates.indexOf(d) !== c) {
        badDates.push(c);
        messages.push(`± column ${c + 1}: ${longDate(d)} is already used by another column.`);
      }
    });
    return { cells, badDates, messages };
  });

  constructor() {
    const stop = onSnapshot(
      collection(db, PRAYERS),
      (snap) => {
        const docs = new Map(snap.docs.map((d) => [d.id, d.data() as PrayerDoc]));
        this.empty.set(!PRAYER_KEYS.some((k) => docs.has(k)));
        const loaded = this.fromDocs(docs);
        // Keep the admin's unsaved edits; only refresh the form when it matches what was saved.
        if (!this.dirty()) this.form.set(loaded);
        else if (!snap.metadata.hasPendingWrites && JSON.stringify(loaded) !== JSON.stringify(this.saved())) {
          this.notice.set('Someone else just saved prayer times. Revert to load them, or Save to overwrite.');
        }
        this.saved.set(loaded);
        this.updated.set(lastUpdated(docs));
      },
      (e) => this.notice.set(errorMessage(e)),
    );
    inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Firestore docs → form. Whatever has already taken effect (next week, ± dates up to today) is
   * folded into "this week", so the form only holds what's still ahead.
   */
  private fromDocs(docs: Map<string, PrayerDoc>): Form {
    let effectiveDate = '';
    let rolled = false;
    const pending = new Map<SalahKey, { next: PrayerDoc['next']; changes: Map<string, number> }>();
    const base = PRAYER_KEYS.map((key) => {
      const p = docs.get(key);
      if (!p || !isHhmm(p.current?.adhan) || !isHhmm(p.current?.iqamah)) {
        pending.set(key, { next: null, changes: new Map() });
        return { key, adhan: p?.current?.adhan ?? '', iqamah: p?.current?.iqamah ?? '' };
      }
      const next = p.next && isHhmm(p.next.adhan) && isHhmm(p.next.iqamah) ? p.next : null;
      const adjustments = (p.adjustments ?? []).filter(isAdjustment);
      const schedule: PrayerSchedule = {
        current: { adhan: hhmmToMinutes(p.current.adhan), iqamah: hhmmToMinutes(p.current.iqamah) },
        next: next ? { adhan: hhmmToMinutes(next.adhan), iqamah: hhmmToMinutes(next.iqamah), effectiveDate: next.effectiveDate } : null,
        adjustments,
      };
      const now = timesOn(schedule, this.today);
      const nextAhead = next && next.effectiveDate > this.today ? next : null;
      if ((next && !nextAhead) || adjustments.some((a) => a.date <= this.today)) rolled = true;
      if (nextAhead) effectiveDate ||= nextAhead.effectiveDate;
      pending.set(key, {
        next: nextAhead,
        changes: new Map(adjustments.filter((a) => a.date > this.today).map((a) => [a.date, a.minutes])),
      });
      return { key, adhan: minutesToHhmm(now.adhan), iqamah: minutesToHhmm(now.iqamah) };
    });
    const changeDates = [...new Set([...pending.values()].flatMap((p) => [...p.changes.keys()]))].sort();
    const rows = base.map(({ key, adhan, iqamah }): Row => {
      const p = pending.get(key)!;
      return {
        key,
        adhan,
        iqamah,
        nextAdhan: p.next?.adhan ?? '',
        nextIqamah: p.next?.iqamah ?? '',
        changes: changeDates.map((d) => (p.changes.has(d) ? formatDelta(p.changes.get(d)!) : '')),
      };
    });
    if (rolled && !this.dirty()) {
      this.notice.set('Changes dated up to today have taken effect, so they are now shown as this week.');
    }
    return { rows, effectiveDate: effectiveDate || comingSunday(this.data), changeDates };
  }

  protected set(i: number, field: TimeKey, value: string): void {
    this.form.update((f) => ({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)) }));
  }

  protected setDate(value: string): void {
    this.form.update((f) => ({ ...f, effectiveDate: value }));
  }

  /** Stores the delta tidied ("10" → "+10") when it's a number, as typed otherwise (to flag it). */
  protected setChange(i: number, c: number, value: string): void {
    const n = parseDelta(value);
    const text = n === null ? value.trim() : n === 0 ? '' : formatDelta(n);
    this.form.update((f) => ({
      ...f,
      rows: f.rows.map((r, j) => (j === i ? { ...r, changes: r.changes.map((v, k) => (k === c ? text : v)) } : r)),
    }));
  }

  protected setChangeDate(c: number, value: string): void {
    this.form.update((f) => ({ ...f, changeDates: f.changeDates.map((d, k) => (k === c ? value : d)) }));
  }

  /** A new ± column, a week after the last one (or after next week's start). */
  protected addChange(): void {
    this.form.update((f) => {
      const last = f.changeDates.filter(Boolean).sort().at(-1) ?? (this.hasNext() ? f.effectiveDate : this.today);
      return {
        ...f,
        changeDates: [...f.changeDates, plusDays(last, 7)],
        rows: f.rows.map((r) => ({ ...r, changes: [...r.changes, ''] })),
      };
    });
  }

  protected removeChange(c: number): void {
    this.form.update((f) => ({
      ...f,
      changeDates: f.changeDates.filter((_, k) => k !== c),
      rows: f.rows.map((r) => ({ ...r, changes: r.changes.filter((_, k) => k !== c) })),
    }));
  }

  protected isChanged(r: Row, f: TimeKey): boolean {
    if (f === 'nextAdhan') return !!r.nextAdhan && r.nextAdhan !== r.adhan;
    if (f === 'nextIqamah') return !!r.nextIqamah && r.nextIqamah !== r.iqamah;
    return false;
  }

  protected fillFromFiles(): void {
    try {
      const files = prayersFromFiles(this.data);
      this.form.update((f) => ({
        ...f,
        effectiveDate: files.effectiveDate,
        rows: f.rows.map((r) => ({
          ...r,
          adhan: files.current[r.key].adhan,
          iqamah: files.current[r.key].iqamah,
          nextAdhan: files.next[r.key].adhan,
          nextIqamah: files.next[r.key].iqamah,
        })),
      }));
      this.notice.set('Filled from the CSV files. Check the times, then Save.');
    } catch (e) {
      this.notice.set(errorMessage(e));
    }
  }

  protected copyToNext(): void {
    this.form.update((f) => ({ ...f, rows: f.rows.map((r) => ({ ...r, nextAdhan: r.adhan, nextIqamah: r.iqamah })) }));
  }

  /**
   * Next week becomes this week; next week is cleared and moves to the following Sunday.
   * ± columns dated before next week's old start are dropped (next week's times already replaced them).
   */
  protected promote(): void {
    this.form.update((f) => {
      const keep = f.changeDates.map((d) => !d || d >= f.effectiveDate);
      return {
        effectiveDate: comingSunday(this.data),
        changeDates: f.changeDates.filter((_, k) => keep[k]),
        rows: f.rows.map((r) => ({
          ...r,
          adhan: r.nextAdhan || r.adhan,
          iqamah: r.nextIqamah || r.iqamah,
          nextAdhan: '',
          nextIqamah: '',
          changes: r.changes.filter((_, k) => keep[k]),
        })),
      };
    });
    this.notice.set("Next week's times moved to this week. Enter the new next week, then Save.");
  }

  protected revert(): void {
    this.form.set(this.saved());
    this.notice.set('');
  }

  protected async save(): Promise<void> {
    if (this.errors().length) return;
    this.saving.set(true);
    this.notice.set('');
    const { rows, effectiveDate, changeDates } = this.form();
    try {
      const batch = writeBatch(db);
      rows.forEach((r, order) => {
        const adjustments: Adjustment[] = [];
        changeDates.forEach((date, c) => {
          const minutes = parseDelta(r.changes[c] ?? '');
          if (date && minutes) adjustments.push({ date, minutes });
        });
        const value: PrayerDoc = {
          order,
          name: PRAYER_NAMES[r.key],
          current: { adhan: r.adhan, iqamah: r.iqamah },
          next: r.nextAdhan && r.nextIqamah ? { adhan: r.nextAdhan, iqamah: r.nextIqamah, effectiveDate } : null,
          adjustments: adjustments.sort((a, b) => a.date.localeCompare(b.date)),
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.email,
        };
        batch.set(doc(db, PRAYERS, r.key), value);
      });
      await batch.commit();
      this.saved.set(this.form());
      this.notice.set('Saved. Screens update within a few seconds.');
    } catch (e) {
      this.notice.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }
}

function lastUpdated(docs: Map<string, PrayerDoc>): string {
  let latest: { at: Date; by?: string } | null = null;
  for (const d of docs.values()) {
    const at = d.updatedAt instanceof Timestamp ? d.updatedAt.toDate() : null;
    if (at && (!latest || at > latest.at)) latest = { at, by: d.updatedBy };
  }
  if (!latest) return '';
  const when = latest.at.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  return latest.by ? `${when} by ${latest.by}` : when;
}
