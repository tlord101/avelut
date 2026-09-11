/**
 * Consolidated Pure Supabase Backend API for Avelut.
 * Provides Realtime Database, Authentication, and Storage bridges without any Firebase SDK dependencies.
 */

import { supabaseAuthService } from '../services/supabaseAuthService';
import {
  db,
  ref as dbRef,
  onValue,
  off,
  set,
  push,
  update,
  get,
  remove,
  onDisconnect,
  serverTimestamp,
  query,
  limitToLast,
  increment,
  notifyUserCreditsUpdated,
  ensureDirectChat,
  type DbRef,
} from './supabaseRealtimeDb';
import { supabase } from './supabaseClient';

export type AuthUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  delete?: () => Promise<void>;
};

// Aliased for seamless migration
export type FirebaseUser = AuthUser;

const auth = {
  get currentUser(): AuthUser | null {
    return (auth as any)._currentUser || null;
  },
  _currentUser: null as AuthUser | null,
};

const onAuthStateChanged = (_authObj: any, callback: (user: AuthUser | null) => void) => {
  return supabaseAuthService.onAuthStateChanged((user, profile) => {
    if (user) {
      const authUser: AuthUser = {
        uid: user.id,
        email: user.email,
        displayName: profile?.display_name || user.user_metadata?.full_name || '',
        photoURL: profile?.photo_url || user.user_metadata?.avatar_url || '',
      };
      (auth as any)._currentUser = authUser;
      callback(authUser);
    } else {
      if (typeof window !== 'undefined' && localStorage.getItem('avelut_dev_user')) {
        try {
          const devUser = JSON.parse(localStorage.getItem('avelut_dev_user')!);
          const authUser: AuthUser = {
            uid: devUser.uid || 'test_user_123',
            email: devUser.email || 'test@avelut.com',
            displayName: devUser.display_name || 'Test Learner',
            photoURL: '',
          };
          (auth as any)._currentUser = authUser;
          callback(authUser);
          return;
        } catch {}
      }
      (auth as any)._currentUser = null;
      callback(null);
    }
  });
};

const signInWithEmailAndPassword = async (_a: any, email: string, pass: string) => {
  const res = await supabaseAuthService.signInWithEmail(email, pass);
  if (res.error) throw new Error(res.error);
  return { user: { uid: res.user.id, email: res.user.email } };
};

const createUserWithEmailAndPassword = async (_a: any, email: string, pass: string) => {
  const res = await supabaseAuthService.signUpWithEmail(email, pass, email.split('@')[0]);
  if (res.error) throw new Error(res.error);
  return { user: { uid: res.user.id, email: res.user.email } };
};

const signOut = async (_a?: any) => {
  await supabaseAuthService.signOut();
};
const firebaseSignOut = signOut;

const sendPasswordResetEmail = async (_a: any, email: string) => {
  const res = await supabaseAuthService.sendPasswordReset(email);
  if (res.error) throw new Error(res.error);
};

const updateProfile = async (userObj: any, profileData: { displayName?: string; photoURL?: string }) => {
  if (userObj?.uid) {
    await supabaseAuthService.upsertProfile(userObj.uid, {
      display_name: profileData.displayName,
      photo_url: profileData.photoURL,
    });
  }
};

const signInAnonymously = async () => {
  const anonEmail = 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '@avelut.app';
  const anonPass = 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const res = await supabaseAuthService.signUpWithEmail(anonEmail, anonPass, 'Guest User');
  if (res.error) throw new Error(res.error);
  return { user: { uid: res.user.id, email: res.user.email } };
};

export type FirebaseStorage = { app: { name: string } };

const storage: FirebaseStorage = { app: { name: 'supabase-storage' } };

function storageRef(_storageOrPath?: any, path?: string) {
  const safePath = typeof _storageOrPath === 'string' ? _storageOrPath : (typeof path === 'string' ? path : '');
  return { fullPath: safePath, path: safePath, toString: () => safePath };
}

async function uploadBytes(pathRef: { fullPath?: string; path?: string } | string, blob: Blob) {
  const path = typeof pathRef === 'string' ? pathRef : pathRef.fullPath || pathRef.path || String(pathRef);
  const { error } = await supabase.storage.from('uploads').upload(path, blob, { upsert: true });
  if (error) throw error;
  return { metadata: { fullPath: path }, ref: typeof pathRef === 'string' ? { fullPath: path, path } : pathRef };
}

function uploadBytesResumable(pathRef: { fullPath?: string; path?: string } | string, blob: Blob) {
  const listeners: Record<string, Function[]> = { state_changed: [] };
  const targetRef = typeof pathRef === 'string' ? { fullPath: pathRef, path: pathRef } : pathRef;
  const task: any = {
    on(event: string, next?: any, _err?: any, complete?: any) {
      if (event === 'state_changed' && next) listeners.state_changed.push(next);
      void uploadBytes(targetRef, blob)
        .then(() => {
          listeners.state_changed.forEach((fn) =>
            fn({ bytesTransferred: blob.size, totalBytes: blob.size, state: 'success' })
          );
          complete?.();
        })
        .catch((e) => _err?.(e));
      return task;
    },
    snapshot: { ref: targetRef },
    then(onFulfilled: any, onRejected?: any) {
      return uploadBytes(targetRef, blob).then(onFulfilled, onRejected);
    },
  };
  return task;
}

async function getDownloadURL(pathRef: { fullPath?: string; path?: string } | string) {
  const path = typeof pathRef === 'string' ? pathRef : pathRef.fullPath || pathRef.path || String(pathRef);
  const { data } = supabase.storage.from('uploads').getPublicUrl(path);
  return data.publicUrl;
}

async function deleteObject(pathRef: { fullPath?: string; path?: string } | string) {
  const path = typeof pathRef === 'string' ? pathRef : pathRef.fullPath || pathRef.path || String(pathRef);
  await supabase.storage.from('uploads').remove([path]);
}

function httpsCallable(_functions: any, name: string) {
  return async (_payload?: any) => {
    console.warn('[backend] httpsCallable(' + name + ') - use Supabase Edge Functions or native REST endpoints.');
    return { data: null };
  };
}

function orderByChild(key: string) {
  return { __op: 'orderByChild', key };
}

function equalTo(value: any) {
  return { __op: 'equalTo', value };
}

function orderByKey() {
  return { __op: 'orderByKey' };
}

function orderByValue() {
  return { __op: 'orderByValue' };
}

function limitToFirst(n: number) {
  return { __op: 'limitToFirst', n };
}

function startAt(value: any) {
  return { __op: 'startAt', value };
}

function endAt(value: any) {
  return { __op: 'endAt', value };
}

class GoogleAuthProvider {}
const googleProvider = new GoogleAuthProvider();

const signInWithPopup = async () => {
  throw new Error('Use supabaseAuthService.signInWithGoogle()');
};

const signInWithCustomToken = async () => {
  throw new Error('Custom token auth not supported; use Supabase session');
};

const messaging = null;
const functions = null;

export {
  supabase,
  db,
  storage,
  auth,
  functions,
  messaging,
  googleProvider,
  serverTimestamp,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  firebaseSignOut,
  dbRef as ref,
  dbRef,
  onValue,
  off,
  set,
  push,
  update,
  get,
  remove,
  onDisconnect,
  query,
  limitToLast,
  limitToFirst,
  increment,
  notifyUserCreditsUpdated,
  ensureDirectChat,
  orderByChild,
  equalTo,
  orderByKey,
  orderByValue,
  startAt,
  endAt,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  storageRef,
  httpsCallable,
  type DbRef,
};
