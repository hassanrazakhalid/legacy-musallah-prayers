import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { AppUpdates } from './core/app-updates';
import { MasjidData } from './core/masjid-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withHashLocation()),
    // Load the masjid's schedule before first render so times never flash from calculated to published.
    provideAppInitializer(() => inject(MasjidData).load()),
    // Offline support and installability (production builds only; see ngsw-config.json).
    // The clock ticks forever, so the app never goes "stable": register after a short delay instead.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWithDelay:2000' }),
    provideAppInitializer(() => inject(AppUpdates).start()),
  ],
};
