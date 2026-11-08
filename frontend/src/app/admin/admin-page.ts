import { ChangeDetectionStrategy, Component, inject, signal, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MasjidData } from '../core/masjid-data';
import { AdminAuth, errorMessage } from './admin-auth';
import { JumuahTab } from './jumuah-tab';
import { PrayersTab } from './prayers-tab';

type Tab = 'prayers' | 'jumuah';

/** `#/admin`: sign in, then edit prayer and Jumu'ah times in Firestore. */
@Component({
  selector: 'app-admin-page',
  imports: [RouterLink, PrayersTab, JumuahTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Shared by the tabs; every rule is scoped under .admin.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './admin.scss',
  template: `
    <div class="admin">
      <header class="bar">
        <div>
          <div class="title">{{ data.config().masjid.name }}</div>
          <div class="subtitle">Prayer times admin</div>
        </div>
        <nav>
          <a routerLink="/">View display</a>
          @if (auth.user(); as u) {
            <span class="who">{{ auth.profile()?.name || u.email }}</span>
            <button type="button" class="ghost" (click)="auth.signOut()">Sign out</button>
          }
        </nav>
      </header>

      @switch (auth.state()) {
        @case ('loading') {
          <p class="panel center">Loading…</p>
        }
        @case ('signedOut') {
          <form class="panel login" (submit)="signIn($event, email.value, password.value)">
            <h1>Sign in</h1>
            <label>Email <input #email type="email" name="email" autocomplete="username" required /></label>
            <label>
              Password
              <input #password type="password" name="password" autocomplete="current-password" required />
            </label>
            @if (loginError()) {
              <p class="error">{{ loginError() }}</p>
            }
            @if (loginInfo()) {
              <p class="notice">{{ loginInfo() }}</p>
            }
            <button type="submit" class="primary" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
            <button type="button" class="link" (click)="reset(email.value)">Forgot password?</button>
          </form>
        }
        @case ('notAdmin') {
          <div class="panel center">
            <h1>No admin access</h1>
            <p>
              {{ auth.email }} is signed in but isn't an admin. In the Firebase console, add a document
              <code>users/{{ auth.user()?.uid }}</code> with <code>role: "admin"</code>. This page updates by itself.
            </p>
          </div>
        }
        @case ('error') {
          <div class="panel center">
            <h1>Couldn't check admin access</h1>
            <p class="error">{{ auth.error() }}</p>
          </div>
        }
        @case ('admin') {
          <div class="tabs" role="tablist">
            <button type="button" role="tab" [attr.aria-selected]="tab() === 'prayers'" (click)="tab.set('prayers')">
              Prayer times
            </button>
            <button type="button" role="tab" [attr.aria-selected]="tab() === 'jumuah'" (click)="tab.set('jumuah')">
              Jumu'ah
            </button>
          </div>
          <!-- Both stay mounted so switching tabs keeps unsaved edits. -->
          <section class="panel" role="tabpanel" [hidden]="tab() !== 'prayers'"><app-prayers-tab /></section>
          <section class="panel" role="tabpanel" [hidden]="tab() !== 'jumuah'"><app-jumuah-tab /></section>
        }
      }
    </div>
  `,
})
export class AdminPage {
  protected readonly auth = inject(AdminAuth);
  protected readonly data = inject(MasjidData);
  protected readonly tab = signal<Tab>('prayers');
  protected readonly busy = signal(false);
  protected readonly loginError = signal('');
  protected readonly loginInfo = signal('');

  protected async signIn(event: Event, email: string, password: string): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.loginError.set('');
    this.loginInfo.set('');
    try {
      await this.auth.signIn(email, password);
    } catch (e) {
      this.loginError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async reset(email: string): Promise<void> {
    this.loginError.set('');
    if (!email.trim()) {
      this.loginError.set('Type your email first.');
      return;
    }
    try {
      await this.auth.resetPassword(email);
      this.loginInfo.set(`If ${email} has an account, a reset link is on its way.`);
    } catch (e) {
      this.loginError.set(errorMessage(e));
    }
  }
}
