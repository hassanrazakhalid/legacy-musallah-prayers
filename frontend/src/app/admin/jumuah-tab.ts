import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../core/firebase';
import { isHhmm, JUMUAH, JumuahDoc } from '../core/firestore-schema';
import { MasjidData } from '../core/masjid-data';
import { AdminAuth, errorMessage } from './admin-auth';
import { jumuahFromFiles } from './from-files';

interface Slot {
  /** Firestore document id; null for a slot that hasn't been saved yet. */
  id: string | null;
  name: string;
  adhan: string;
  khutbah: string;
  iqamah: string;
  location: string;
}
type Field = Exclude<keyof Slot, 'id'>;

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Jumu'ah slots (any number): name, adhan, khutbah, iqamah and location, in display order. */
@Component({
  selector: 'app-jumuah-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="toolbar">
      <button type="button" class="ghost" (click)="add()">+ Add Jumu'ah</button>
      <button type="button" class="ghost" (click)="fillFromFiles()">Fill from current files</button>
      <span class="spacer"></span>
      @if (dirty()) {
        <span class="unsaved">Unsaved changes</span>
        <button type="button" class="ghost" (click)="revert()">Revert</button>
      }
      <button type="button" class="primary" (click)="save()" [disabled]="!dirty() || errors().length || saving()">
        {{ saving() ? 'Saving…' : 'Save' }}
      </button>
    </div>

    @if (notice()) {
      <p class="notice">{{ notice() }}</p>
    }

    <div class="scroll">
      <table class="grid">
        <thead>
          <tr>
            <th class="order"></th>
            <th>Name</th>
            <th>Adhan</th>
            <th>Khutbah</th>
            <th>Iqamah</th>
            <th>Location</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (s of slots(); track $index; let i = $index, first = $first, last = $last) {
            <tr>
              <td class="order">
                <button type="button" class="icon" (click)="move(i, -1)" [disabled]="first" aria-label="Move up">↑</button>
                <button type="button" class="icon" (click)="move(i, 1)" [disabled]="last" aria-label="Move down">↓</button>
              </td>
              <td><input type="text" [value]="s.name" (input)="set(i, 'name', $any($event.target).value)" aria-label="Name" /></td>
              @for (f of timeFields; track f) {
                <td>
                  <input
                    type="time"
                    [value]="s[f]"
                    [class.invalid]="invalid().has(i + f)"
                    (input)="set(i, f, $any($event.target).value)"
                    [attr.aria-label]="s.name + ' ' + f"
                  />
                </td>
              }
              <td>
                <input type="text" [value]="s.location" (input)="set(i, 'location', $any($event.target).value)" aria-label="Location" />
              </td>
              <td><button type="button" class="icon danger" (click)="remove(i)" aria-label="Remove">✕</button></td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="none">No Jumu'ah slots. The display shows "Jumu'ah times will be announced."</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (errors().length) {
      <ul class="errors">
        @for (e of errors(); track e) {
          <li>{{ e }}</li>
        }
      </ul>
    }
    <p class="help">Khutbah is optional. The display shows the slots in this order on Fridays.</p>
  `,
})
export class JumuahTab {
  private readonly auth = inject(AdminAuth);
  private readonly data = inject(MasjidData);

  protected readonly timeFields = ['adhan', 'khutbah', 'iqamah'] as const;

  protected readonly slots = signal<Slot[]>([]);
  private readonly saved = signal<Slot[]>([]);
  protected readonly saving = signal(false);
  protected readonly notice = signal('');

  protected readonly dirty = computed(() => JSON.stringify(this.slots()) !== JSON.stringify(this.saved()));
  protected readonly invalid = computed(() => new Set(this.check().cells));
  protected readonly errors = computed(() => this.check().messages);

  private readonly check = computed(() => {
    const cells: string[] = [];
    const messages: string[] = [];
    this.slots().forEach((s, i) => {
      const name = s.name || `Row ${i + 1}`;
      if (!isHhmm(s.adhan)) (cells.push(i + 'adhan'), messages.push(`${name}: adhan is required.`));
      if (!isHhmm(s.iqamah)) (cells.push(i + 'iqamah'), messages.push(`${name}: iqamah is required.`));
      if (isHhmm(s.adhan) && isHhmm(s.iqamah) && s.adhan > s.iqamah) {
        cells.push(i + 'adhan');
        messages.push(`${name}: adhan is after iqamah.`);
      }
      if (isHhmm(s.khutbah) && isHhmm(s.iqamah) && s.khutbah > s.iqamah) {
        cells.push(i + 'khutbah');
        messages.push(`${name}: khutbah is after iqamah.`);
      }
    });
    return { cells, messages };
  });

  constructor() {
    const stop = onSnapshot(
      collection(db, JUMUAH),
      (snap) => {
        const loaded = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as JumuahDoc) }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(
            (j): Slot => ({
              id: j.id,
              name: j.name ?? '',
              adhan: j.adhan ?? '',
              khutbah: j.khutbah ?? '',
              iqamah: j.iqamah ?? '',
              location: j.location ?? '',
            }),
          );
        if (!this.dirty()) this.slots.set(loaded);
        else if (!snap.metadata.hasPendingWrites && JSON.stringify(loaded) !== JSON.stringify(this.saved())) {
          this.notice.set("Someone else just saved Jumu'ah times. Revert to load them, or Save to overwrite.");
        }
        this.saved.set(loaded);
      },
      (e) => this.notice.set(errorMessage(e)),
    );
    inject(DestroyRef).onDestroy(stop);
  }

  protected set(i: number, field: Field, value: string): void {
    this.slots.update((all) => all.map((s, j) => (j === i ? { ...s, [field]: value } : s)));
  }

  protected add(): void {
    this.slots.update((all) => {
      const prev = all.at(-1);
      const n = all.length + 1;
      return [
        ...all,
        { id: null, name: `${ordinal(n)} Jumu'ah`, adhan: '', khutbah: '', iqamah: '', location: prev?.location ?? '' },
      ];
    });
  }

  protected remove(i: number): void {
    this.slots.update((all) => all.filter((_, j) => j !== i));
  }

  protected move(i: number, delta: number): void {
    this.slots.update((all) => {
      const copy = [...all];
      [copy[i], copy[i + delta]] = [copy[i + delta], copy[i]];
      return copy;
    });
  }

  /** Replaces the rows with jumuah.csv (existing documents are reused, extras deleted on Save). */
  protected fillFromFiles(): void {
    const files = jumuahFromFiles(this.data);
    if (!files.length) {
      this.notice.set('jumuah.csv has no rows.');
      return;
    }
    const ids = this.slots().map((s) => s.id);
    this.slots.set(files.map((j, i) => ({ ...j, id: ids[i] ?? null, khutbah: j.khutbah ?? '' })));
    this.notice.set('Filled from jumuah.csv. Check the times, then Save.');
  }

  protected revert(): void {
    this.slots.set(this.saved());
    this.notice.set('');
  }

  protected async save(): Promise<void> {
    if (this.errors().length) return;
    this.saving.set(true);
    this.notice.set('');
    try {
      const batch = writeBatch(db);
      const keep = new Set<string>();
      const slots = this.slots().map((s, order) => {
        const ref = s.id ? doc(db, JUMUAH, s.id) : doc(collection(db, JUMUAH));
        keep.add(ref.id);
        const value: JumuahDoc = {
          order,
          name: s.name.trim() || `${ordinal(order + 1)} Jumu'ah`,
          adhan: s.adhan,
          khutbah: s.khutbah || null,
          iqamah: s.iqamah,
          location: s.location.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.email,
        };
        batch.set(ref, value);
        return { ...s, id: ref.id, name: value.name, location: value.location };
      });
      for (const s of this.saved()) if (s.id && !keep.has(s.id)) batch.delete(doc(db, JUMUAH, s.id));
      await batch.commit();
      this.slots.set(slots);
      this.saved.set(slots);
      this.notice.set('Saved. Screens update within a few seconds.');
    } catch (e) {
      this.notice.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) e.preventDefault();
  }
}
