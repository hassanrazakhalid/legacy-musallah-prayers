import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { MasjidData } from './core/masjid-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withHashLocation()),
    // Load the masjid's schedule before first render so times never flash from calculated to published.
    provideAppInitializer(() => inject(MasjidData).load()),
  ],
};
