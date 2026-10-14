import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

const CX = 500;
const HORIZON = 400;
const R = 330;
const MOON_R = 26;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Point on the wheel at `deg` degrees (0 = east horizon, 90 = zenith, 180 = west horizon). */
function wheelPoint(deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: CX - R * Math.cos(a), y: HORIZON - R * Math.sin(a) };
}

/** SVG path of the lit part of the moon for a phase in [0, 1). Northern-hemisphere view. */
function moonPath(phase: number, r: number): string {
  const waxing = phase < 0.5;
  const crescent = (1 - Math.cos(2 * Math.PI * phase)) / 2 < 0.5;
  const rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
  const limbSweep = waxing ? 1 : 0;
  const terminatorSweep = waxing === crescent ? 0 : 1;
  return `M 0 ${-r} A ${r} ${r} 0 0 ${limbSweep} 0 ${r} A ${rx.toFixed(2)} ${r} 0 0 ${terminatorSweep} 0 ${-r} Z`;
}

/**
 * Hero scene: the sun and moon sit on opposite ends of one wheel pivoting at the
 * centre of the horizon. By day the sun sweeps the upper 180°; as it sets in the
 * west, the moon rises in the east and sweeps the same arc through the night.
 */
@Component({
  selector: 'app-sun-scene',
  templateUrl: './sun-scene.html',
  styleUrl: './sun-scene.scss',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SunScene {
  protected readonly store = inject(PrayerStore);

  protected readonly cx = CX;
  protected readonly horizon = HORIZON;
  protected readonly moonR = MOON_R;
  protected readonly arcPath = `M ${CX - R} ${HORIZON} A ${R} ${R} 0 0 1 ${CX + R} ${HORIZON}`;
  protected readonly east = CX - R;
  protected readonly west = CX + R;

  protected readonly sun = computed(() => {
    const s = this.store.sky();
    const low = 1 - clamp(s.altitude / 20, 0, 1);
    return { ...wheelPoint(s.wheel), color: s.sunColor, r: 30 + low * 8, glow: 130 + low * 90 };
  });

  protected readonly moon = computed(() => {
    const s = this.store.sky();
    return {
      ...wheelPoint(s.wheel + 180),
      path: moonPath(s.moonPhase, MOON_R),
      glow: 60 + 90 * s.moonIllumination,
      phaseName: phaseLabel(s.moonPhase),
    };
  });

  /** Whichever body is above the horizon, and how far along the arc it is. */
  private readonly upDeg = computed(() => {
    const w = this.store.sky().wheel;
    return w <= 180 ? w : w - 180;
  });

  protected readonly hand = computed(() => wheelPoint(this.upDeg()));

  protected readonly travelled = computed(() => {
    const deg = this.upDeg();
    if (deg <= 0.5) return null;
    const { x, y } = wheelPoint(deg);
    return `M ${CX - R} ${HORIZON} A ${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  /** Prayers on the arc of whichever body is up: Dhuhr/Asr for the sun, Isha/Fajr for the moon. */
  protected readonly markers = computed(() => {
    const { start, end, markers } = this.store.arc();
    const t0 = start.time.getTime();
    const span = end.time.getTime() - t0;
    const current = this.store.currentKey();
    const up = this.upDeg();
    return markers.map((m) => {
      const deg = (180 * (m.time.getTime() - t0)) / span;
      // Hide the label while the sun/moon passes over it.
      return { ...m, active: current === m.key, covered: Math.abs(deg - up) < 9, ...wheelPoint(deg) };
    });
  });

  protected readonly isNight = computed(() => this.store.sky().daylight < 0.5);
}

function phaseLabel(p: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(p * 8) % 8];
}
