import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Keeps the installed app (and the TV, which stays open for weeks) on the latest build. The service
 * worker downloads a new version in the background, then the display reloads into it. The admin page
 * isn't reloaded under someone mid-edit: it picks the new version up on its next launch.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly sw = inject(SwUpdate);
  private readonly router = inject(Router);

  start(): void {
    if (!this.sw.isEnabled) return;

    this.sw.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY' && !this.router.url.startsWith('/admin')) location.reload();
    });
    // The cached version can't be served any more (e.g. its files were evicted): start fresh.
    this.sw.unrecoverable.subscribe(() => location.reload());

    const check = () => this.sw.checkForUpdate().catch(() => undefined);
    setInterval(check, CHECK_EVERY_MS);
    // Phones suspend the app in the background; check when it comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }
}
