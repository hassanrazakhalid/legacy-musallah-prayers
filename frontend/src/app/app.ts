import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Clock } from './core/clock';
import { Display } from './core/display';
import { PrayerStore } from './core/prayer-store';
import { Jumuah } from './ui/jumuah/jumuah';
import { SkyBackdrop } from './ui/sky-backdrop/sky-backdrop';
import { SunScene } from './ui/sun-scene/sun-scene';
import { TimeTravel } from './ui/time-travel/time-travel';
import { TodayTimes } from './ui/today-times/today-times';

@Component({
  selector: 'app-root',
  imports: [SkyBackdrop, SunScene, TodayTimes, Jumuah, TimeTravel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
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
export class App {
  protected readonly store = inject(PrayerStore);
  protected readonly display = inject(Display);

  constructor() {
    // `?at=19:05` opens the page previewing that time of day (handy for sharing designs).
    const at = new URLSearchParams(location.search).get('at')?.match(/^(\d{1,2}):(\d{2})$/);
    if (at) {
      const minutes = Number(at[1]) * 60 + Number(at[2]);
      inject(Clock).previewAt(new Date(this.store.midnight().getTime() + minutes * 60_000));
    }

    effect(() => {
      document.title = `${this.store.next().label} in ${this.store.countdown()} · Prayer Times`;
    });
  }
}
