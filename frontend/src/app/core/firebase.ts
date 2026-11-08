import { isDevMode } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
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
export const useEmulator = isDevMode() && new URLSearchParams(location.search).has('emulator');

export const firebaseApp = initializeApp(useEmulator ? { ...firebaseConfig, projectId: 'demo-legacy' } : firebaseConfig);

/** Cached on disk so a screen that reloads while offline still shows the last times it saw. */
export const db = initializeFirestore(firebaseApp, {
  localCache: useEmulator
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);
