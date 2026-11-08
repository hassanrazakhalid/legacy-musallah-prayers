import { Injectable, signal } from '@angular/core';
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, firebaseApp, useEmulator } from '../core/firebase';
import { UserDoc, USERS } from '../core/firestore-schema';

export type AuthState = 'loading' | 'signedOut' | 'notAdmin' | 'admin' | 'error';

/**
 * Email/password sign-in (Firebase Auth). Being signed in isn't enough to edit: the account also
 * needs a users/{uid} document with role "admin". The Firestore rules enforce the same check.
 */
@Injectable({ providedIn: 'root' })
export class AdminAuth {
  private readonly auth = getAuth(firebaseApp);

  readonly state = signal<AuthState>('loading');
  readonly user = signal<User | null>(null);
  readonly profile = signal<UserDoc | null>(null);
  /** Why the admin check failed, when state is 'error'. */
  readonly error = signal('');
  private stopProfile?: () => void;

  constructor() {
    if (useEmulator) connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    onAuthStateChanged(this.auth, (user) => {
      this.stopProfile?.();
      this.stopProfile = undefined;
      this.user.set(user);
      this.profile.set(null);
      this.error.set('');
      if (!user) {
        this.state.set('signedOut');
        return;
      }
      this.state.set('loading');
      // Live, so granting or removing the admin role in the console takes effect without a reload.
      this.stopProfile = onSnapshot(
        doc(db, USERS, user.uid),
        (snap) => {
          if (!snap.exists() && snap.metadata.fromCache) return; // wait for the server's answer
          const profile = (snap.data() as UserDoc | undefined) ?? null;
          this.profile.set(profile);
          this.state.set(profile?.role === 'admin' ? 'admin' : 'notAdmin');
        },
        (e) => {
          console.warn('[admin] could not read the users document', e);
          this.error.set(errorMessage(e));
          this.state.set('error');
        },
      );
    });
  }

  get email(): string {
    return this.user()?.email ?? '';
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
  }

  signOut(): Promise<void> {
    // Stop listening first, or the listener fails with permission-denied as the session ends.
    this.stopProfile?.();
    this.stopProfile = undefined;
    return signOut(this.auth);
  }

  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email.trim());
  }
}

/** A readable message for a Firebase Auth or Firestore error. */
export function errorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or reset the password.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'No connection to Firebase. Check the internet connection and try again.';
    case 'permission-denied':
      return "Permission denied: this account isn't an admin, or the Firestore rules aren't deployed.";
    default:
      return (e as Error)?.message ?? String(e);
  }
}
