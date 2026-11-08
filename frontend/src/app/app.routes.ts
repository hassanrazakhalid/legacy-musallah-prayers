import { Routes } from '@angular/router';
import { DisplayPage } from './ui/display-page/display-page';

/**
 * Hash URLs (`#/admin`) because GitHub Pages can't serve a deep link like `/admin`.
 * The admin page is lazy-loaded, so the display (and the TV) never download Firebase Auth.
 */
export const routes: Routes = [
  { path: '', component: DisplayPage },
  {
    path: 'admin',
    title: 'Admin · Prayer Times',
    loadComponent: () => import('./admin/admin-page').then((m) => m.AdminPage),
  },
  { path: '**', redirectTo: '' },
];
