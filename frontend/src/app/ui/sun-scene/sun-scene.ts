import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

const CX = 500;
const HORIZON = 400;
const R = 330;
const MOON_R = 26;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Point on the arc at `deg` degrees (0 = left horizon, 90 = top, 180 = right horizon). */
function wheelPoint(deg: number, radius = R) {
  const a = (deg * Math.PI) / 180;
  return { x: CX - radius * Math.cos(a), y: HORIZON - radius * Math.sin(a) };
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

/** Arc positions (0° = left horizon, 180° = right) of the six prayer-day markers, evenly spaced. */
const SLOTS = [10, 42, 74, 106, 138, 170];
/** How long, at the wrap-around (180° → 0°), the marker takes to fade out and back in. */
const WRAP_FADE = 0.12;

/**
 * Hero scene: the prayer day on a semicircle — Fajr, Sunrise, Zuhr, Asr, Maghrib, Isha,
 * left to right. A marker travels along it through the day: the sun in daylight, the moon
 * otherwise. After Isha it runs off the right end and returns from the left before Fajr.
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

  /** Where the marker is on the arc (degrees) and how visible it is (fades at the wrap-around). */
  private readonly position = computed(() => {
    const now = this.store.now().getTime();
    const { today, prevIsha, nextFajr } = this.store.prayerCycle();
    const times = today.map((p) => p.adhan.getTime());

    const night = (from: number, to: number) => {
      // Isha → (end of arc) … (start of arc) → Fajr, fading out and back in at the ends.
      const p = clamp((now - from) / (to - from), 0, 1);
      const deg = p < 0.5 ? SLOTS[5] + (180 - SLOTS[5]) * (p / 0.5) : SLOTS[0] * ((p - 0.5) / 0.5);
      return { deg, opacity: clamp(Math.abs(p - 0.5) / WRAP_FADE, 0, 1) };
    };

    if (now < times[0]) return night(prevIsha.getTime(), times[0]);
    if (now >= times[5]) return night(times[5], nextFajr.getTime());
    const i = times.filter((t) => t <= now).length - 1;
    const f = (now - times[i]) / (times[i + 1] - times[i]);
    return { deg: SLOTS[i] + (SLOTS[i + 1] - SLOTS[i]) * f, opacity: 1 };
  });

  protected readonly point = computed(() => wheelPoint(this.position().deg));

  /** Sun by day, moon by night, cross-fading with the real daylight. */
  protected readonly sun = computed(() => {
    const s = this.store.sky();
    const low = 1 - clamp(s.altitude / 20, 0, 1);
    return {
      ...this.point(),
      color: s.sunColor,
      r: 30 + low * 8,
      glow: 130 + low * 90,
      opacity: s.daylight * this.position().opacity,
    };
  });

  protected readonly moon = computed(() => {
    const s = this.store.sky();
    return {
      ...this.point(),
      path: moonPath(s.moonPhase, MOON_R),
      glow: 60 + 90 * s.moonIllumination,
      phaseName: phaseLabel(s.moonPhase),
      opacity: (1 - s.daylight) * this.position().opacity,
    };
  });

  /** The part of the prayer day already passed, from the left end to the marker. */
  protected readonly travelled = computed(() => {
    const { deg } = this.position();
    if (deg <= 0.5) return null;
    const { x, y } = wheelPoint(deg);
    return `M ${CX - R} ${HORIZON} A ${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  protected readonly markers = computed(() => {
    const current = this.store.currentKey();
    const now = this.store.now().getTime();
    const at = this.position().deg;
    return this.store.prayerCycle().today.map((p, i) => {
      const dot = wheelPoint(SLOTS[i]);
      // Labels sit just outside the arc, anchored away from it.
      const label = wheelPoint(SLOTS[i], R + 26);
      const anchor = SLOTS[i] < 75 ? 'end' : SLOTS[i] > 105 ? 'start' : 'middle';
      return {
        key: p.key,
        label: p.label,
        time: p.adhan,
        active: current === p.key,
        // Passed today (the current prayer is highlighted as active instead).
        done: current !== p.key && p.adhan.getTime() <= now,
        // Hide the label while the sun/moon passes over it.
        covered: Math.abs(SLOTS[i] - at) < 7,
        ...dot,
        lx: label.x,
        ly: label.y,
        anchor,
      };
    });
  });

  protected readonly isNight = computed(() => this.store.sky().daylight < 0.5);
}

function phaseLabel(p: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(p * 8) % 8];
}
