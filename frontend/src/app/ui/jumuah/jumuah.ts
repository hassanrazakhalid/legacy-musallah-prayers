import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { JumuahRow, PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

/**
 * Friday prayers as a two-row table: Khutbah times, then Iqamah times, one column per Jumu'ah.
 * On Fridays the next Jumu'ah is highlighted and past ones dim.
 */
@Component({
  selector: 'app-jumuah',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card glass">
      @if (store.jumuah().length) {
        <table>
          <caption>
            Jumu'ah <span class="arabic">الجمعة</span>
            @if (!showLocations() && sharedLocation()) {
              <span class="where">· {{ sharedLocation() }}</span>
            }
          </caption>
          <thead class="sr-only">
            <tr>
              <td></td>
              @for (j of store.jumuah(); track $index) {
                <th scope="col">{{ j.name }}{{ showLocations() && j.location ? ', ' + j.location : '' }}</th>
              }
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Khutbah</th>
              @for (j of store.jumuah(); track $index) {
                <td [class]="state(j)">
                  @if (j.khutbah) {
                    {{ j.khutbah | prayerTime }}
                  } @else {
                    <span class="na">—</span>
                  }
                </td>
              }
            </tr>
            <tr class="iqamah">
              <th scope="row">Iqamah</th>
              @for (j of store.jumuah(); track $index) {
                <td [class]="state(j)">{{ j.iqamah | prayerTime }}</td>
              }
            </tr>
          </tbody>
        </table>
      } @else {
        <p class="empty">Jumu'ah times will be announced.</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      container-type: inline-size;
      padding-top: 0.75rem;
      padding-bottom: 0.75rem;
    }
    table {
      width: 100%;
      border-collapse: separate;
      /* Columns are spaced apart; the two rows touch, so each Jumu'ah reads as one shaded block. */
      border-spacing: 0.375rem 0;
      table-layout: fixed;
    }
    caption {
      caption-side: top;
      text-align: left;
      padding: 0 0.375rem 0.25rem;
      font-family: 'Fraunces', serif;
      font-size: min(1.75rem, 3cqw);
      font-weight: 600;
    }
    .arabic {
      font-family: 'Amiri', serif;
      font-weight: 400;
      opacity: 0.7;
      margin-left: 0.25rem;
    }
    .where {
      font-family: inherit;
      font-size: 0.6em;
      font-weight: 400;
      opacity: 0.7;
      margin-left: 0.25rem;
    }
    th[scope='row'] {
      width: 18%;
      text-align: left;
      padding-left: 0.375rem;
      font-size: min(1.375rem, 2.4cqw);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.75;
    }
    td {
      text-align: center;
      padding: 0.375rem 0.25rem;
      background: rgba(255, 255, 255, 0.06);
      font-size: min(2.5rem, 3.6cqw);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      transition: background 0.4s ease, opacity 0.4s ease;
    }
    tbody tr:first-child td {
      border-radius: 0.75rem 0.75rem 0 0;
    }
    .iqamah td {
      font-weight: 700;
      border-radius: 0 0 0.75rem 0.75rem;
    }
    td.next {
      background: color-mix(in srgb, var(--accent) 28%, transparent);
    }
    td.done {
      opacity: 0.5;
    }
    .na {
      opacity: 0.4;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .empty {
      margin: 0;
      opacity: 0.7;
    }
    /* TV: keep the table short so the schedule above has room. */
    :host-context(html.tv) td {
      font-size: min(2.25rem, 3cqw);
      padding: 0.25rem;
    }
    :host-context(html.tv) caption {
      font-size: min(1.5rem, 2.4cqw);
    }
        /* Phones: fixed sizes, the label column narrows. */
    @media (max-width: 600px) {
      table {
        border-spacing: 0.1875rem 0;
      }
      caption {
        font-size: 1.375rem;
      }
      th[scope='row'] {
        width: 3.5rem;
        padding-left: 0.125rem;
        font-size: 0.625rem;
        letter-spacing: 0.02em;
      }
      /* "AM/PM" wraps under the time so the numbers can stay readable. */
      td {
        font-size: 1rem;
        line-height: 1.1;
        white-space: normal;
        padding: 0.375rem 0.125rem;
      }
    }
  `,
})
export class Jumuah {
  protected readonly store = inject(PrayerStore);

  /** Only show a location on each tile when the Jumu'ahs are in different places. */
  private readonly locations = computed(() => new Set(this.store.jumuah().map((j) => j.location).filter(Boolean)));
  protected readonly showLocations = computed(() => this.locations().size > 1);
  protected readonly sharedLocation = computed(() => (this.locations().size === 1 ? [...this.locations()][0] : ''));

  protected state(j: JumuahRow): string {
    return this.store.isFriday() ? j.state : '';
  }
}
