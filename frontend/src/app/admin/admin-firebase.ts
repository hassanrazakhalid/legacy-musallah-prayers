import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { appOptions, useEmulator } from '../core/firebase';

/**
 * A separate Firebase app for the admin page. The display's Firestore shares one network connection
 * across all open tabs of the site (multi-tab cache), and that connection belongs to whichever tab
 * started first. If that's a display tab, which never signs in, the admin's reads and writes go out
 * signed-out and are denied. This instance keeps no shared cache, so it always uses the admin's sign-in.
 */
const app = initializeApp(appOptions, 'admin');

export const adminAuth = getAuth(app);
export const adminDb = initializeFirestore(app, { localCache: memoryLocalCache() });

if (useEmulator) {
  connectAuthEmulator(adminAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(adminDb, '127.0.0.1', 8080);
}
