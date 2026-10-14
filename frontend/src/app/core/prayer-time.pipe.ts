import { inject, Pipe, PipeTransform } from '@angular/core';
import { PrayerStore } from './prayer-store';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Formats an instant as a wall-clock time (e.g. "5:42 AM") in the masjid's time zone. */
@Pipe({ name: 'prayerTime' })
export class PrayerTimePipe implements PipeTransform {
  private readonly store = inject(PrayerStore);

  transform(value: Date | null | undefined, style: 'full' | 'short' = 'full'): string {
    if (!value) return '—';
    const tz = this.store.location().timeZone;
    const key = `${tz}|${style}`;
    let f = formatters.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
      formatters.set(key, f);
    }
    const text = f.format(value);
    return style === 'short' ? text.replace(/\s?[AP]M$/, '') : text;
  }
}
