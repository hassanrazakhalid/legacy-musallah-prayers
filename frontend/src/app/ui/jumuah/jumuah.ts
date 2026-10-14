import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PrayerStore } from '../../core/prayer-store';
import { PrayerTimePipe } from '../../core/prayer-time.pipe';

/** Friday prayers: one tile per Jumu'ah, any number of them (wraps to fit). */
@Component({
  selector: 'app-jumuah',
  imports: [PrayerTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card glass">
      <header class="card-head">
        <h2>Jumu'ah <span class="arabic">الجمعة</span></h2>
        <span class="hint">{{ store.isFriday() ? 'Today' : store.jumuahLabel() }}</span>
      </header>

      @if (store.jumuah().length) {
        <ol class="slots">
          @for (j of store.jumuah(); track $index) {
            <li class="slot" [class.next]="store.isFriday() && j.state === 'next'" [class.done]="store.isFriday() && j.state === 'done'">
              <div class="name">{{ j.name }}</div>
              <div class="iqamah">{{ j.iqamah | prayerTime }}</div>
              <div class="sub">Iqamah</div>
              <dl class="details">
                @if (j.khutbah) {
                  <dt>Khutbah</dt>
                  <dd>{{ j.khutbah | prayerTime }}</dd>
                }
                <dt>Adhan</dt>
                <dd>{{ j.adhan | prayerTime }}</dd>
              </dl>
              @if (showLocations() && j.location) {
                <div class="location">{{ j.location }}</div>
              }
            </li>
          }
        </ol>
        @if (!showLocations() && sharedLocation()) {
          <p class="shared-location">All at {{ sharedLocation() }}</p>
        }
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
      height: 100%;
    }
    .arabic {
      font-family: 'Amiri', serif;
      font-weight: 400;
      opacity: 0.7;
      margin-left: 0.375rem;
    }
    .slots {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
      gap: 0.625rem;
    }
    .slot {
      padding: 0.75rem 0.875rem;
      border-radius: 0.875rem;
      background: rgba(255, 255, 255, 0.06);
      transition: background 0.4s ease, opacity 0.4s ease;
    }
    .slot.next {
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
    }
    .slot.done {
      opacity: 0.5;
    }
    .name {
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .iqamah {
      font-size: 1.375rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      margin: 0.125rem 0;
    }
    .sub {
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.6;
      margin-top: -0.125rem;
    }
    .details {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.125rem 0.5rem;
      margin: 0.5rem 0 0;
      font-size: 0.8125rem;
    }
    .details dt {
      opacity: 0.65;
    }
    .details dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .location {
      margin-top: 0.25rem;
      font-size: 0.8125rem;
      opacity: 0.75;
    }
    .shared-location {
      margin: 0.75rem 0.25rem 0;
      font-size: 0.8125rem;
      opacity: 0.7;
    }
    .empty {
      margin: 0;
      opacity: 0.7;
    }
  `,
})
export class Jumuah {
  protected readonly store = inject(PrayerStore);

  /** Only show a location on each tile when the Jumu'ahs are in different places. */
  private readonly locations = computed(() => new Set(this.store.jumuah().map((j) => j.location).filter(Boolean)));
  protected readonly showLocations = computed(() => this.locations().size > 1);
  protected readonly sharedLocation = computed(() => (this.locations().size === 1 ? [...this.locations()][0] : ''));
}
