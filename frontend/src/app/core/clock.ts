import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

/** How fast "play day" runs: one full day in 40 seconds. */
const PLAY_SPEED = (24 * 3_600_000) / 40_000;

/**
 * The app's notion of "now". Live by default; can be pinned to a preview instant
 * or fast-forwarded so the sky animation can be explored during design.
 */
@Injectable({ providedIn: 'root' })
export class Clock {
  private readonly live = signal(new Date());
  private readonly preview = signal<Date | null>(null);
  private frame = 0;

  readonly playing = signal(false);
  readonly now = computed(() => this.preview() ?? this.live());
  readonly isLive = computed(() => this.preview() === null);

  constructor() {
    const id = setInterval(() => this.live.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(id);
      cancelAnimationFrame(this.frame);
    });
  }

  previewAt(date: Date): void {
    this.preview.set(date);
  }

  goLive(): void {
    this.stop();
    this.preview.set(null);
  }

  togglePlay(): void {
    if (this.playing()) this.stop();
    else this.play();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.playing.set(false);
  }

  private play(): void {
    this.playing.set(true);
    let last = performance.now();
    const step = (ts: number) => {
      const dt = ts - last;
      last = ts;
      this.preview.set(new Date(this.now().getTime() + dt * PLAY_SPEED));
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}
