import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { Clock } from './clock';
import { PrayerStore } from './prayer-store';

const STORAGE_KEY = 'iqamah-chime';
/** Only chime for an iqamah reached within this window, so a late page load or a sleeping tab stays quiet. */
const LATE_MS = 15_000;

/**
 * Beeps when an iqamah time arrives (the five daily prayers, and each Jumu'ah on Fridays).
 * Browsers keep audio locked until the page is clicked or a key is pressed, so `blocked`
 * says when a tap is still needed. On a kiosk, start Chrome with
 * `--autoplay-policy=no-user-gesture-required` to skip that.
 */
@Injectable({ providedIn: 'root' })
export class IqamahChime {
  private readonly clock = inject(Clock);
  private readonly store = inject(PrayerStore);
  private ctx: AudioContext | null = null;

  readonly enabled = signal(readEnabled());
  private readonly audioState = signal<AudioContextState | 'none'>('none');
  readonly blocked = computed(() => this.enabled() && this.audioState() !== 'running');

  /** Today's iqamah times, as epoch ms. */
  private readonly iqamahTimes = computed(() => [
    ...this.store.prayers().flatMap((p) => (p.iqamah ? [p.iqamah.getTime()] : [])),
    ...(this.store.isFriday() ? this.store.jumuah().map((j) => j.iqamah.getTime()) : []),
  ]);

  constructor() {
    this.audio();
    const unlock = () => void this.ctx?.resume();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
      void this.ctx?.close();
    });

    let last: number | null = null;
    effect(() => {
      const now = this.clock.now().getTime();
      const live = this.clock.isLive();
      const prev = last;
      last = live ? now : null;
      if (!live || prev === null || !this.enabled()) return;
      if (this.iqamahTimes().some((t) => prev < t && t <= now && now - t < LATE_MS)) this.beep();
    });
  }

  toggle(): void {
    const on = !this.enabled();
    this.enabled.set(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Storage unavailable (private mode): the choice lasts for this visit only.
    }
    if (on) this.beep();
  }

  /** One steady one-second tone. */
  beep(): void {
    const ctx = this.audio();
    if (!ctx) return;
    void ctx.resume();
    const t = ctx.currentTime + 0.05;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.setValueAtTime(0.4, t + 0.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.05);
  }

  private audio(): AudioContext | null {
    if (!this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
      this.audioState.set(this.ctx.state);
      this.ctx.onstatechange = () => this.audioState.set(this.ctx!.state);
    }
    return this.ctx;
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
