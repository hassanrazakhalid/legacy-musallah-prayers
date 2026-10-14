import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MasjidData } from './core/masjid-data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Load the masjid's schedule before first render so times never flash from calculated to published.
    provideAppInitializer(() => inject(MasjidData).load()),
  ],
};
