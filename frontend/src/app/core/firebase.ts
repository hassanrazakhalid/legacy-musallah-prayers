import { isDevMode } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { launchParams } from './launch-params';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

/**
 * Firebase web config for the legacy-musallah project. These values are public by design:
 * access is controlled by the Firestore security rules (firestore.rules at the repo root).
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyA82uD4KJhLMpKl0k9lqVXTRYPIvGm4dn0',
  authDomain: 'legacy-musallah.firebaseapp.com',
  projectId: 'legacy-musallah',
  storageBucket: 'legacy-musallah.firebasestorage.app',
  messagingSenderId: '80017173809',
  appId: '1:80017173809:web:f7ea4ce1d1d18970661410',
};

/**
 * `ng serve` with `?emulator` uses the local Firebase emulators (`firebase emulators:start` from the
 * repo root) instead of the real project. Production builds ignore it.
 */
export const useEmulator = isDevMode() && launchParams.has('emulator');

/** Options for initializeApp (the emulators need a demo- project id). */
export const appOptions = useEmulator ? { ...firebaseConfig, projectId: 'demo-legacy' } : firebaseConfig;

export const firebaseApp = initializeApp(appOptions);

/**
 * The display's Firestore: cached on disk so a screen that reloads while offline still shows the last
 * times it saw. Read-only and signed out; the admin page has its own instance (admin/admin-firebase.ts).
 */
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);
