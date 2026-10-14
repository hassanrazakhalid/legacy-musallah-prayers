import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

@Component({
  selector: 'app-monthly-timetable',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card glass">
      <header class="card-head">
        <h2>Iqamah Timetable</h2>
        <div class="nav">
          <button type="button" (click)="store.shiftMonth(-1)" aria-label="Previous month">‹</button>
          <button type="button" class="month" (click)="store.shiftMonth(0)" title="Back to this month">
            {{ store.monthLabel() }}
          </button>
          <button type="button" (click)="store.shiftMonth(1)" aria-label="Next month">›</button>
        </div>
      </header>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="day">Date</th>
              @for (h of headers; track h) {
                <th>{{ h }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (r of store.monthRows(); track r.ymd.d) {
              <tr
                [class.today]="r.isToday"
                [class.friday]="r.isFriday"
                [class.unpublished]="!r.published"
                [attr.title]="r.published ? null : 'Not in the published schedule: calculated adhan times'"
              >
                <td class="day">
                  <strong>{{ r.ymd.d }}</strong> <span>{{ r.weekday }}</span>
                </td>
                @for (p of r.rows; track p.key) {
                  <td [class.muted]="p.key === 'sunrise'" [class.problem]="p.problem" [attr.title]="p.problem">
                    {{ p.iqamah ?? p.adhan | prayerTime: 'short' }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="note">Iqamah times (sunrise is calculated). Italic rows aren't in the published schedule yet. Orange times fall
        outside their prayer's window — hover for details.</p>
    </section>
  `,
  styles: `
    .nav {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .nav button {
      border: 0;
      color: inherit;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 62.4375rem;
      height: 2rem;
      min-width: 2rem;
      font: inherit;
      font-size: 1.125rem;
      cursor: pointer;
    }
    .nav button:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .nav .month {
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0 0.875rem;
      min-width: 9.375rem;
    }
    .scroll {
      overflow-x: auto;
      max-height: 32.5rem;
      overflow-y: auto;
      border-radius: 0.75rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
      font-size: 0.875rem;
    }
    th {
      position: sticky;
      top: 0;
      background: rgba(10, 16, 40, 0.85);
      backdrop-filter: blur(0.5rem);
      font-size: 0.6875rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 600;
      opacity: 0.9;
      padding: 0.625rem 0.75rem;
      text-align: right;
      z-index: 1;
    }
    td {
      padding: 0.5625rem 0.75rem;
      text-align: right;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
    }
    .day {
      text-align: left;
    }
    .day span {
      opacity: 0.6;
      margin-left: 0.375rem;
      font-size: 0.75rem;
    }
    .muted {
      opacity: 0.6;
    }
    tr.friday td {
      background: rgba(255, 255, 255, 0.04);
    }
    td.problem {
      color: #ffb35c;
      font-weight: 600;
      text-decoration: underline dotted;
    }
    tr.unpublished td:not(.day) {
      font-style: italic;
      opacity: 0.55;
    }
    .note {
      margin: 0.75rem 0.25rem 0;
      font-size: 0.75rem;
      opacity: 0.6;
    }
    tr.today td {
      background: color-mix(in srgb, var(--accent) 24%, transparent);
      font-weight: 600;
    }
  `,
})
export class MonthlyTimetable {
  protected readonly store = inject(PrayerStore);
  protected readonly headers = ['Fajr', 'Sunrise', 'Zuhr', 'Asr', 'Maghrib', 'Isha'];
}
