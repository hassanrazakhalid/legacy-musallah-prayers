import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../core/firebase';
import {
  hhmmToMinutes,
  isHhmm,
  PRAYER_KEYS,
  PRAYER_NAMES,
  PrayerDoc,
  PRAYERS,
  SalahKey,
} from '../core/firestore-schema';
import { MasjidData } from '../core/masjid-data';
import { AdminAuth, errorMessage } from './admin-auth';
import { comingSunday, prayersFromFiles, todayKey } from './from-files';
import { TimeField } from './time-field';

interface Row {
  key: SalahKey;
  adhan: string;
  iqamah: string;
  nextAdhan: string;
  nextIqamah: string;
}
type Field = Exclude<keyof Row, 'key'>;

interface Form {
  rows: Row[];
  /** When next week's times take effect (YYYY-MM-DD). */
  effectiveDate: string;
}

const emptyRows = (): Row[] =>
  PRAYER_KEYS.map((key) => ({ key, adhan: '', iqamah: '', nextAdhan: '', nextIqamah: '' }));

/** "13:05" → "1:05 PM" for messages. */
function clock(hhmm: string): string {
  const mins = hhmmToMinutes(hhmm);
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, d),
  );
}

/**
 * The five daily prayers: this week's adhan/iqamah and next week's, with the date next week starts.
 * The display switches to next week's times on that date by itself; "Promote" then tidies the form
 * so next week can be entered.
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
      @if (updated()) {
        <br />Last saved {{ updated() }}.
      }
    </p>
  `,
})
export class PrayersTab {
  private readonly auth = inject(AdminAuth);
  private readonly data = inject(MasjidData);

  protected readonly names = PRAYER_NAMES;
  protected readonly fields: Field[] = ['adhan', 'iqamah', 'nextAdhan', 'nextIqamah'];
  protected readonly labels: Record<Field, string> = {
    adhan: 'adhan this week',
    iqamah: 'iqamah this week',
    nextAdhan: 'adhan next week',
    nextIqamah: 'iqamah next week',
  };
  protected readonly today = todayKey(this.data);

  protected readonly form = signal<Form>({ rows: emptyRows(), effectiveDate: comingSunday(this.data) });
  /** The form as last loaded from Firestore. */
  private readonly saved = signal<Form>(this.form());
  protected readonly empty = signal(false);
  protected readonly saving = signal(false);
  protected readonly notice = signal('');
  protected readonly updated = signal('');

  protected readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.saved()));
  protected readonly hasNext = computed(() => this.form().rows.some((r) => r.nextAdhan || r.nextIqamah));
  protected readonly dateLabel = computed(() => (this.form().effectiveDate ? longDate(this.form().effectiveDate) : '—'));

  /** Cells to outline red, keyed `${prayer}${field}`. */
  protected readonly invalid = computed(() => new Set(this.check().cells));
  protected readonly errors = computed(() => this.check().messages);

  private readonly check = computed(() => {
    const { rows, effectiveDate } = this.form();
    const cells: string[] = [];
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
    }
    if (rows.some((r) => r.nextAdhan || r.nextIqamah)) {
      if (!effectiveDate) messages.push('Choose the date next week starts.');
      else if (effectiveDate < this.today) messages.push('The next-week date is in the past.');
    }
    return { cells, messages };
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

  /** Firestore docs → form. If next week has already started, it's shown as this week. */
  private fromDocs(docs: Map<string, PrayerDoc>): Form {
    let effectiveDate = '';
    let rolled = false;
    const rows = PRAYER_KEYS.map((key): Row => {
      const p = docs.get(key);
      const next = p?.next ?? null;
      if (next && next.effectiveDate <= this.today) {
        rolled = true;
        return { key, adhan: next.adhan, iqamah: next.iqamah, nextAdhan: '', nextIqamah: '' };
      }
      if (next) effectiveDate ||= next.effectiveDate;
      return {
        key,
        adhan: p?.current.adhan ?? '',
        iqamah: p?.current.iqamah ?? '',
        nextAdhan: next?.adhan ?? '',
        nextIqamah: next?.iqamah ?? '',
      };
    });
    if (rolled && !this.dirty()) {
      this.notice.set("Next week's times have taken effect and are shown as this week. Enter the following week's times, then Save.");
    }
    return { rows, effectiveDate: effectiveDate || comingSunday(this.data) };
  }

  protected set(i: number, field: Field, value: string): void {
    this.form.update((f) => ({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)) }));
  }

  protected setDate(value: string): void {
    this.form.update((f) => ({ ...f, effectiveDate: value }));
  }

  protected isChanged(r: Row, f: Field): boolean {
    if (f === 'nextAdhan') return !!r.nextAdhan && r.nextAdhan !== r.adhan;
    if (f === 'nextIqamah') return !!r.nextIqamah && r.nextIqamah !== r.iqamah;
    return false;
  }

  protected fillFromFiles(): void {
    try {
      const files = prayersFromFiles(this.data);
      this.form.set({
        effectiveDate: files.effectiveDate,
        rows: PRAYER_KEYS.map((key) => ({
          key,
          adhan: files.current[key].adhan,
          iqamah: files.current[key].iqamah,
          nextAdhan: files.next[key].adhan,
          nextIqamah: files.next[key].iqamah,
        })),
      });
      this.notice.set('Filled from the CSV files. Check the times, then Save.');
    } catch (e) {
      this.notice.set(errorMessage(e));
    }
  }

  protected copyToNext(): void {
    this.form.update((f) => ({ ...f, rows: f.rows.map((r) => ({ ...r, nextAdhan: r.adhan, nextIqamah: r.iqamah })) }));
  }

  /** Next week becomes this week; next week is cleared and moves to the following Sunday. */
  protected promote(): void {
    this.form.update((f) => ({
      effectiveDate: comingSunday(this.data),
      rows: f.rows.map((r) => ({
        ...r,
        adhan: r.nextAdhan || r.adhan,
        iqamah: r.nextIqamah || r.iqamah,
        nextAdhan: '',
        nextIqamah: '',
      })),
    }));
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
    const { rows, effectiveDate } = this.form();
    try {
      const batch = writeBatch(db);
      rows.forEach((r, order) => {
        const value: PrayerDoc = {
          order,
          name: PRAYER_NAMES[r.key],
          current: { adhan: r.adhan, iqamah: r.iqamah },
          next: r.nextAdhan && r.nextIqamah ? { adhan: r.nextAdhan, iqamah: r.nextIqamah, effectiveDate } : null,
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
