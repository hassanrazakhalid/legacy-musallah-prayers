import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

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
        <span class="time week-head">{{ store.nextChangeLabel() }}</span>
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
              <span class="sub">
                <span class="arabic">{{ p.arabic }}</span>
                @if (store.currentKey() === p.key) {
                  <span class="badge">Now</span>
                } @else if (store.next() === p) {
                  <span class="badge soft">Next</span>
                }
              </span>
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
            <div class="time week" [class.changed]="r.changed" [attr.title]="r.changed ? 'Iqamah changes' : 'No schedule change'">
              {{ r.week | prayerTime }}
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
      <p class="foot">Last column: the next iqamah schedule change, on {{ store.nextChangeLabel() }}.</p>
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
      /* Times scale with the card's width so they never collide on narrower laptops. */
      container-type: inline-size;
    }
    .card-head h2 {
      font-size: 2.125rem;
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
      grid-template-columns: 0.9fr 1fr 1fr 1fr;
      gap: 1rem;
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
      flex-direction: column;
      gap: 0.125rem;
    }
    .sub {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .label {
      font-weight: 600;
      font-size: min(2.375rem, 5.2cqw);
      line-height: 1.1;
    }
    .arabic {
      font-family: 'Amiri', serif;
      font-size: 1.375rem;
      opacity: 0.7;
    }
    /* Adhan, iqamah and next week share one large size: bigger than the prayer names. */
    .time {
      font-variant-numeric: tabular-nums;
      text-align: right;
      font-size: min(3.25rem, 5.7cqw);
      white-space: nowrap;
    }
    .iqamah {
      font-weight: 700;
    }
    .na {
      opacity: 0.4;
    }
    .badge {
      align-self: center;
      font-size: 0.75rem;
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
      font-size: 1rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      opacity: 0.65;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0;
      margin-bottom: 0.375rem;
    }
    .cols .time {
      font-size: 1rem;
    }
    .week {
      opacity: 0.75;
    }
    .week.changed {
      opacity: 1;
      color: var(--accent);
    }
    :host-context(html.tv) .row:not(.cols) {
      padding-top: 0.45rem;
      padding-bottom: 0.45rem;
    }
    /* TV: the card is a size container, so the rows shrink to fit its height; warnings drop
       (the orange flags in the table still mark problems). */
    :host-context(html.tv) .card {
      container-type: size;
      overflow: hidden;
    }
    :host-context(html.tv) .row:not(.cols) .time {
      font-size: min(3.25rem, 5.7cqw, 5.6cqh);
    }
    :host-context(html.tv) .label {
      font-size: min(2.375rem, 5.2cqw, 4.4cqh);
    }
    :host-context(html.tv) .arabic {
      font-size: min(1.375rem, 2.8cqh);
    }
    :host-context(html.tv) .foot,
    :host-context(html.tv) .warning {
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
    /* Phones: placed last so it overrides the sizes above. */
    @media (max-width: 480px) {
      .row {
        grid-template-columns: 1.1fr 1fr 1fr 0.85fr;
        padding: 0.75rem 0.5rem;
        gap: 0.25rem;
      }
      .time {
        font-size: 0.9375rem;
      }
      .label {
        font-size: 1.0625rem;
      }
      .arabic {
        display: none;
      }
      .cols,
      .cols .time {
        font-size: 0.6875rem;
        letter-spacing: 0.08em;
      }
    }
  `,
})
export class TodayTimes {
  protected readonly store = inject(PrayerStore);

  /** Today's rows paired with the times at the next schedule change (iqamah; adhan for sunrise). */
  protected readonly rows = computed(() => {
    const later = this.store.nextChangePrayers();
    const changed = this.store.changedPrayers();
    return this.store.prayers().map((p, i) => ({
      p,
      week: later[i].iqamah ?? later[i].adhan,
      changed: changed.has(p.key),
    }));
  });
}
