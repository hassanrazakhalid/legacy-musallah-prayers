import { ChangeDetectionStrategy, Component, computed, ElementRef, signal, viewChild } from '@angular/core';
import {
  calendarPath,
  isReminders,
  NO_REMINDERS,
  REMINDER_CHOICES,
  ReminderMinutes,
  Reminders,
} from '../../core/calendar-presets';
import { PRAYER_KEYS, PRAYER_NAMES, SalahKey } from '../../core/firestore-schema';

const STORAGE_KEY = 'prayer-calendar';

interface Saved {
  reminders: Reminders;
  /** The calendar file last subscribed to, to spot reminder changes that need a new subscription. */
  subscribed: string | null;
}

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && isReminders(saved.reminders)) return { reminders: saved.reminders, subscribed: saved.subscribed ?? null };
  } catch {
    // Unreadable or blocked storage: start from the defaults.
  }
  return { reminders: { ...NO_REMINDERS }, subscribed: null };
}

/**
 * Subscribe to the masjid's prayer times in Apple or Google Calendar, with a reminder per prayer.
 * The choices pick one of the pre-built calendar files (see calendar-presets.ts) and are saved on
 * this device. Open with open(); the trigger button lives in the page header.
 */
@Component({
  selector: 'app-calendar-panel',
  template: `
    <dialog #dialog class="panel" aria-labelledby="calendar-title" (click)="onBackdrop($event)">
      <div class="body">
      <form method="dialog" class="close-form">
        <button class="close" aria-label="Close">×</button>
      </form>
      <h2 id="calendar-title">Prayer times in your calendar</h2>
      <p class="lead">Subscribe once: your calendar keeps itself up to date with the masjid's times.</p>

      <fieldset>
        <legend>Remind me before iqamah</legend>
        @for (key of keys; track key) {
          <div class="prayer">
            <span>{{ names[key] }}</span>
            <div class="choices" role="radiogroup" [attr.aria-label]="names[key] + ' reminder'">
              @for (m of choices; track m) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="reminders()[key] === m"
                  (click)="set(key, m)"
                >
                  {{ m ? m + ' min' : 'Off' }}
                </button>
              }
            </div>
          </div>
        }
      </fieldset>
      <p class="note">Saved on this device.</p>

      @if (needsResubscribe()) {
        <p class="warn">
          Your reminders changed. Subscribe again, then delete the old "Legacy Musallah Prayer Times" calendar.
        </p>
      }

      <div class="actions">
        <a class="primary" [href]="webcalUrl()" (click)="subscribed()">Subscribe in Apple Calendar</a>
        <a class="primary" [href]="googleUrl()" target="_blank" rel="noopener" (click)="subscribed()">Add to Google Calendar</a>
        <button type="button" class="link" (click)="copy()">{{ copied() ? 'Link copied' : 'Copy calendar link' }}</button>
      </div>

      <details>
        <summary>Getting the reminders</summary>
        <p><b>iPhone / Mac:</b> on the subscribe screen, turn off <i>Remove Alerts</i> so the reminders above are kept.</p>
        <p>
          <b>Google Calendar</b> doesn't use these reminders: open the calendar's settings in Google Calendar and add a
          notification there.
        </p>
        <p><b>Outlook</b> and others: add the copied link as an internet calendar.</p>
      </details>
      </div>
    </dialog>
  `,
  styles: `
    .panel {
      width: min(28rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      padding: 0;
      border: 1px solid var(--glass-border);
      border-radius: 1.25rem;
      background: #0b1030;
      color: #f6f7fc;
    }
    .body {
      padding: 1.25rem;
    }
    .panel::backdrop {
      background: rgba(3, 5, 15, 0.6);
      backdrop-filter: blur(4px);
    }
    h2 {
      margin: 0 2rem 0.25rem 0;
      font-size: 1.5rem;
    }
    p {
      margin: 0.5rem 0;
      font-size: 0.875rem;
      opacity: 0.85;
    }
    .close-form {
      float: right;
    }
    .close {
      font-size: 1.5rem;
      line-height: 1;
      background: none;
      border: 0;
      color: inherit;
      cursor: pointer;
    }
    fieldset {
      border: 0;
      margin: 1rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    legend {
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .prayer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .choices {
      display: flex;
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      overflow: hidden;
    }
    .choices button {
      padding: 0.375rem 0.625rem;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .choices button[aria-checked='true'] {
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 600;
    }
    .note {
      font-size: 0.75rem;
      opacity: 0.6;
    }
    .warn {
      padding: 0.5rem 0.75rem;
      border-radius: 0.75rem;
      background: rgba(255, 200, 90, 0.15);
      opacity: 1;
    }
    .actions {
      display: grid;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .primary {
      padding: 0.625rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 600;
      text-align: center;
      text-decoration: none;
    }
    .link {
      padding: 0.375rem;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    details {
      margin-top: 0.75rem;
      font-size: 0.875rem;
    }
    summary {
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPanel {
  protected readonly keys = PRAYER_KEYS;
  protected readonly names = PRAYER_NAMES;
  protected readonly choices = REMINDER_CHOICES;

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly saved = signal<Saved>(load());
  protected readonly reminders = computed(() => this.saved().reminders);
  protected readonly copied = signal(false);

  private readonly path = computed(() => calendarPath(this.reminders()));
  /** The https address of the chosen calendar file, under wherever the app is served. */
  private readonly httpsUrl = computed(() => new URL(this.path(), document.baseURI).href);
  protected readonly webcalUrl = computed(() => this.httpsUrl().replace(/^https?:/, 'webcal:'));
  protected readonly googleUrl = computed(
    () => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(this.webcalUrl())}`,
  );
  protected readonly needsResubscribe = computed(() => {
    const { subscribed } = this.saved();
    return subscribed !== null && subscribed !== this.path();
  });

  open(): void {
    this.copied.set(false);
    this.dialog().nativeElement.showModal();
  }

  protected set(key: SalahKey, minutes: ReminderMinutes): void {
    this.update({ reminders: { ...this.reminders(), [key]: minutes } });
  }

  protected subscribed(): void {
    this.update({ subscribed: this.path() });
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.httpsUrl());
      this.copied.set(true);
      this.subscribed();
    } catch {
      prompt('Copy this calendar link:', this.httpsUrl());
    }
  }

  /** A click on the dimmed area outside the panel closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }

  private update(change: Partial<Saved>): void {
    this.saved.update((s) => ({ ...s, ...change }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved()));
    } catch {
      // Private browsing may block storage; the choices still apply until the page closes.
    }
  }
}
