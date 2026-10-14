import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Clock } from '../../core/clock';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

/** Design-phase control: scrub or fast-forward through the day to preview the sky. */
@Component({
  selector: 'app-time-travel',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.idle]': 'idle()' },
  template: `
    <div class="bar glass">
      <button type="button" class="pill" [class.on]="clock.isLive()" (click)="clock.goLive()" title="Back to live time">
        <span class="dot"></span> Live
      </button>
      <button type="button" class="play" (click)="clock.togglePlay()" [attr.aria-label]="clock.playing() ? 'Pause' : 'Play the day'">
        {{ clock.playing() ? '❚❚' : '▶' }}
      </button>
      <input
        type="range"
        min="0"
        max="1439"
        [value]="store.minuteOfDay()"
        (input)="scrub($event)"
        aria-label="Time of day"
      />
      <span class="now">{{ store.now() | prayerTime }}</span>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      left: 50%;
      bottom: 1rem;
      transform: translateX(-50%);
      z-index: 10;
      width: min(35rem, calc(100% - 2rem));
      transition: opacity 0.6s ease, transform 0.6s ease;
    }
    :host(.idle:not(:hover):not(:focus-within)) {
      opacity: 0;
      transform: translate(-50%, 1rem);
      pointer-events: none;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.875rem 0.5rem 0.5rem;
      border-radius: 62.4375rem;
    }
    button {
      border: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 62.4375rem;
      height: 2.125rem;
    }
    button:hover {
      background: rgba(255, 255, 255, 0.22);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.4);
    }
    .pill.on .dot {
      background: #4ade80;
      box-shadow: 0 0 0.5rem #4ade80;
    }
    .play {
      width: 2.125rem;
      font-size: 0.75rem;
      flex: none;
    }
    input[type='range'] {
      flex: 1;
      min-width: 0;
      accent-color: var(--accent);
    }
    .now {
      font-variant-numeric: tabular-nums;
      font-size: 0.8125rem;
      font-weight: 600;
      min-width: 4.125rem;
      text-align: right;
    }
  `,
})
export class TimeTravel {
  protected readonly clock = inject(Clock);
  protected readonly store = inject(PrayerStore);

  /** Fades out after a few seconds without mouse, touch or keyboard activity. */
  protected readonly idle = signal(false);

  constructor() {
    let timer = 0;
    const wake = () => {
      this.idle.set(false);
      clearTimeout(timer);
      timer = setTimeout(() => this.idle.set(true), 4000);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      events.forEach((e) => removeEventListener(e, wake));
    });

  }

  protected scrub(event: Event): void {
    this.clock.stop();
    this.previewMinute(Number((event.target as HTMLInputElement).value));
  }

  private previewMinute(minutes: number): void {
    this.clock.previewAt(new Date(this.store.midnight().getTime() + minutes * 60_000));
  }
}
