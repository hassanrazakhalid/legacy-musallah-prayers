import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';
import { zonedMidnight } from '../../core/zoned-time';

@Component({
  selector: 'app-today-times',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card glass">
      <header class="card-head">
        <h2>Today's Salah</h2>
      </header>

      <div class="row cols" aria-hidden="true">
        <span>Prayer</span>
        <span class="time">Adhan</span>
        <span class="time">Iqamah</span>
        <span class="time week-head">Next week<small>{{ store.nextWeekLabel() }}</small></span>
      </div>

      <ul class="rows">
        @for (r of rows(); track r.p.key) {
          @let p = r.p;
          <li
            class="row"
            [class.current]="store.currentKey() === p.key"
            [class.next]="store.next() === p"
            [class.muted]="p.key === 'sunrise'"
          >
            <div class="name">
              <span class="label">{{ p.label }}</span>
              <span class="arabic">{{ p.arabic }}</span>
              @if (store.currentKey() === p.key) {
                <span class="badge">Now</span>
              } @else if (store.next() === p) {
                <span class="badge soft">Next</span>
              }
            </div>
            <div class="time adhan">{{ p.adhan | prayerTime }}</div>
            <div class="time iqamah" [class.problem]="p.problem" [attr.title]="p.problem">
              @if (p.iqamah) {
                @if (p.problem) {
                  <span class="flag" aria-hidden="true">⚠</span>
                }
                {{ p.iqamah | prayerTime }}
              } @else {
                <span class="na">—</span>
              }
            </div>
            <div class="time week" [class.changed]="r.delta !== 0" [attr.title]="r.title">
              {{ r.week | prayerTime }}
              @if (r.delta !== 0) {
                <small class="delta">{{ r.delta > 0 ? '+' : '−' }}{{ abs(r.delta) }} min</small>
              }
            </div>
          </li>
        }
      </ul>
      @for (p of store.prayers(); track p.key) {
        @if (p.problem) {
          <p class="warning">⚠ {{ p.problem }}. Please check the published schedule.</p>
        }
      }
      @if (!store.todaySchedule().published) {
        <p class="warning">Today isn't in the published schedule yet — showing calculated adhan times.</p>
      }
      <p class="foot">Next week shows the iqamah schedule starting {{ store.nextWeekLabel().replace('from ', '') }}.</p>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .rows {
      flex: 1;
      align-content: space-evenly;
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.375rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1.3fr 1fr 1fr 1.1fr;
      gap: 0.5rem;
      align-items: center;
      padding: 0.875rem 1rem;
      border-radius: 0.875rem;
      transition: background 0.4s ease, transform 0.4s ease;
    }
    .row.muted {
      opacity: 0.65;
    }
    .row.current {
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--accent) 30%, transparent),
        color-mix(in srgb, var(--accent) 8%, transparent)
      );
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
    }
    .row.next {
      background: rgba(255, 255, 255, 0.08);
    }
    .name {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.25rem 0.625rem;
    }
    @media (max-width: 480px) {
      .row {
        padding: 0.75rem 0.625rem;
        gap: 0.375rem;
      }
      .time {
        font-size: 0.8125rem;
      }
      .label {
        font-size: 0.9375rem;
      }
      .arabic {
        display: none;
      }
    }
    .label {
      font-weight: 600;
      font-size: 1.0625rem;
    }
    .arabic {
      font-family: 'Amiri', serif;
      font-size: 1rem;
      opacity: 0.7;
    }
    .time {
      font-variant-numeric: tabular-nums;
      text-align: right;
      font-size: 1rem;
    }
    .iqamah {
      font-weight: 600;
    }
    .na {
      opacity: 0.4;
    }
    .badge {
      align-self: center;
      font-size: 0.625rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 0.1875rem 0.4375rem;
      border-radius: 62.4375rem;
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 700;
    }
    .badge.soft {
      background: rgba(255, 255, 255, 0.85);
      color: #1b2440;
    }
    .cols {
      padding-top: 0;
      padding-bottom: 0.5rem;
      font-size: 0.6875rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      opacity: 0.65;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0;
      margin-bottom: 0.375rem;
    }
    .cols .time {
      font-size: 0.6875rem;
    }
    .week-head small {
      display: block;
      letter-spacing: 0.04em;
      text-transform: none;
      opacity: 0.8;
      margin-top: 0.125rem;
    }
    .week {
      opacity: 0.75;
    }
    .week.changed {
      opacity: 1;
      color: var(--accent);
    }
    .delta {
      display: block;
      font-size: 0.6875rem;
      opacity: 0.85;
    }
    :host-context(html.tv) .row:not(.cols) {
      padding-top: 0.45rem;
      padding-bottom: 0.45rem;
    }
    :host-context(html.tv) .foot {
      display: none;
    }
    .problem {
      color: #ffb35c;
    }
    .flag {
      margin-right: 0.25rem;
    }
    .warning {
      margin: 0.875rem 0.25rem 0;
      padding: 0.5rem 0.75rem;
      border-radius: 0.625rem;
      font-size: 0.8125rem;
      background: rgba(255, 170, 60, 0.18);
      box-shadow: inset 0 0 0 1px rgba(255, 170, 60, 0.4);
    }
    .foot {
      margin: 0.875rem 0.25rem 0;
      font-size: 0.75rem;
      opacity: 0.6;
    }
  `,
})
export class TodayTimes {
  protected readonly store = inject(PrayerStore);
  protected readonly abs = Math.abs;

  /** Today's rows paired with next week's iqamah (adhan for sunrise) and the wall-clock change in minutes. */
  protected readonly rows = computed(() => {
    const tz = this.store.location().timeZone;
    const todayMidnight = this.store.midnight().getTime();
    const weekMidnight = zonedMidnight(this.store.nextWeekYmd(), tz).getTime();
    const week = this.store.nextWeekPrayers();
    return this.store.prayers().map((p, i) => {
      const now = p.iqamah ?? p.adhan;
      const later = week[i].iqamah ?? week[i].adhan;
      const delta = Math.round((later.getTime() - weekMidnight - (now.getTime() - todayMidnight)) / 60_000);
      const title =
        delta === 0 ? 'No change next week' : `${Math.abs(delta)} min ${delta > 0 ? 'later' : 'earlier'} than today`;
      return { p, week: later, delta, title };
    });
  });
}
