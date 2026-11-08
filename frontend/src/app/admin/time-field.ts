import { ChangeDetectionStrategy, Component, input, linkedSignal, model } from '@angular/core';
import { isHhmm } from '../core/firestore-schema';

type AmPm = 'AM' | 'PM';

/** "18:05" → { text: "6:05", ampm: "PM" }. Anything else is shown as typed. */
function to12(value: string, fallback: AmPm): { text: string; ampm: AmPm } {
  if (!isHhmm(value)) return { text: value, ampm: fallback };
  const h = Number(value.slice(0, 2));
  return { text: `${h % 12 || 12}:${value.slice(3)}`, ampm: h < 12 ? 'AM' : 'PM' };
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * Reads "6:30", "630", "6", "6:30 pm" (12-hour, using `ampm` unless the text says otherwise)
 * or "18:30" (24-hour). Returns "HH:mm", '' for empty, or null if it isn't a time.
 */
export function parseTime(text: string, ampm: AmPm): string | null {
  const t = text.trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  const suffix = m[3]?.toUpperCase();
  if (suffix || (h >= 1 && h <= 12)) {
    if (h < 1 || h > 12) return null;
    const pm = (suffix ? suffix === 'P' : ampm === 'PM');
    return hhmm((h % 12) + (pm ? 12 : 0), min);
  }
  return h <= 23 ? hhmm(h, min) : null; // 0:xx or 13:xx–23:xx: a 24-hour time
}

/**
 * A time box with an AM/PM picker. The browser's own time input follows the computer's
 * 12/24-hour setting, so on many machines it shows no AM/PM; this one always does.
 * The value is "HH:mm" (24-hour), '' when empty, or the raw text when it can't be read
 * (so the form's validation flags it).
 */
@Component({
  selector: 'app-time-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      type="text"
      inputmode="numeric"
      placeholder="h:mm"
      [value]="text()"
      [class.invalid]="invalid()"
      (change)="commit($any($event.target).value, ampm())"
      [attr.aria-label]="label()"
    />
    <select
      [value]="ampm()"
      (change)="commit(text(), $any($event.target).value)"
      [attr.aria-label]="label() + ', AM or PM'"
    >
      <option value="AM">AM</option>
      <option value="PM">PM</option>
    </select>
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 0.25rem;
    }
    :host input {
      width: 4.75rem;
      min-width: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    :host select {
      font: inherit;
      color: inherit;
      padding: 0.4375rem 0.25rem;
      border-radius: 0.5rem;
      border: 1px solid rgba(199, 212, 255, 0.18);
      background: rgba(255, 255, 255, 0.06);
      color-scheme: dark;
    }
  `,
})
export class TimeField {
  /** "HH:mm" (24-hour) or ''. */
  readonly value = model('');
  readonly label = input('');
  readonly invalid = input(false);
  /** AM/PM to assume while the box is empty (e.g. AM for Fajr). */
  readonly defaultAmPm = input<AmPm>('PM');

  protected readonly text = linkedSignal(() => to12(this.value(), this.defaultAmPm()).text);
  protected readonly ampm = linkedSignal<AmPm>(() => to12(this.value(), this.defaultAmPm()).ampm);

  protected commit(text: string, ampm: AmPm): void {
    this.ampm.set(ampm);
    const parsed = parseTime(text, ampm);
    if (parsed === null) {
      this.text.set(text);
      this.value.set(text.trim());
      return;
    }
    // A typed "pm"/"am" or a 24-hour time decides AM/PM; refresh the box to the tidy form.
    const tidy = to12(parsed, ampm);
    this.text.set(tidy.text);
    this.ampm.set(parsed ? tidy.ampm : ampm);
    this.value.set(parsed);
  }
}
