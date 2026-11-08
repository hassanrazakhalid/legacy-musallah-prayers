import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { Clock } from '../../core/clock';
import { Display } from '../../core/display';
import { IqamahChime } from '../../core/iqamah-chime';
import { PrayerStore } from '../../core/prayer-store';
import { Jumuah } from '../jumuah/jumuah';
import { SkyBackdrop } from '../sky-backdrop/sky-backdrop';
import { SunScene } from '../sun-scene/sun-scene';
import { TimeTravel } from '../time-travel/time-travel';
import { TodayTimes } from '../today-times/today-times';

@Component({
  selector: 'app-display-page',
  imports: [SkyBackdrop, SunScene, TodayTimes, Jumuah, TimeTravel],
  templateUrl: './display-page.html',
  styleUrl: './display-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--sky-top]': 'store.sky().top',
    '[style.--sky-mid]': 'store.sky().mid',
    '[style.--sky-bottom]': 'store.sky().bottom',
    '[style.--ground]': 'store.sky().ground',
    '[style.--accent]': 'store.sky().theme.accent',
    '[style.--accent-ink]': 'store.sky().theme.accentInk',
    '[style.--glass]': 'store.sky().theme.glass',
    '[style.--glass-border]': 'store.sky().theme.glassBorder',
  },
})
export class DisplayPage {
  protected readonly store = inject(PrayerStore);
  protected readonly display = inject(Display);
  protected readonly chime = inject(IqamahChime);

  constructor() {
    this.display.active.set(true);
    inject(DestroyRef).onDestroy(() => this.display.active.set(false));

    // `?at=19:05` opens the page previewing that time of day (handy for sharing designs).
    const at = new URLSearchParams(location.search).get('at')?.match(/^(\d{1,2}):(\d{2})$/);
    if (at) {
      const minutes = Number(at[1]) * 60 + Number(at[2]);
      inject(Clock).previewAt(new Date(this.store.midnight().getTime() + minutes * 60_000));
    }

    effect(() => {
      const { prayer, kind } = this.store.countdownTarget();
      const what = kind === 'iqamah' ? `${prayer.label} iqamah` : prayer.label;
      document.title = `${what} in ${this.store.countdown()} · Prayer Times`;
    });
  }
}
