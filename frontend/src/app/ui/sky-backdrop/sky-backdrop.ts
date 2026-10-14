import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';

interface Star {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

/** Full-page sky gradient with a twinkling star field that fades in after dusk. */
@Component({
  selector: 'app-sky-backdrop',
  templateUrl: './sky-backdrop.html',
  styleUrl: './sky-backdrop.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkyBackdrop {
  private readonly store = inject(PrayerStore);

  protected readonly starOpacity = computed(() => this.store.sky().starOpacity);

  protected readonly stars: Star[] = Array.from({ length: 140 }, () => ({
    x: Math.random() * 100,
    y: Math.pow(Math.random(), 1.6) * 75,
    size: Math.random() < 0.9 ? 1 + Math.random() : 2 + Math.random(),
    delay: Math.random() * 6,
    duration: 2.5 + Math.random() * 4,
  }));
}
