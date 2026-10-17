import type { CellarData } from '../domain/types';

/**
 * The whole cellar is one JSON document. IndexedDB is the primary home;
 * localStorage is a fallback for browsers/modes where IndexedDB is unavailable.
 */

const DB_NAME = 'cellar-book';
const STORE = 'kv';
const KEY = 'cellar';
const LS_KEY = 'cellar-book:data';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('The database is blocked by another tab'));
  });
}

async function idbRead(): Promise<unknown | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbWrite(value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Write was aborted'));
    });
  } finally {
    db.close();
  }
}

function lsRead(): unknown | undefined {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s === null ? undefined : JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Returns what is stored, unvalidated, or `undefined` when nothing has been saved yet. */
export async function readStored(): Promise<unknown | undefined> {
  try {
    const fromIdb = await idbRead();
    if (fromIdb !== undefined) return fromIdb;
  } catch {
    /* fall through to localStorage */
  }
  return lsRead();
}

export async function writeStored(data: CellarData): Promise<void> {
  try {
    await idbWrite(data);
    return;
  } catch (idbError) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      throw idbError instanceof Error ? idbError : new Error('Could not save');
    }
  }
}

/** Asks the browser not to evict our data under storage pressure. Returns null when unsupported. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

// ---- theme (a per-device preference, deliberately not part of the cellar data) ----

export type ThemePreference = 'auto' | 'light' | 'dark';

export function readTheme(): ThemePreference {
  try {
    const t = localStorage.getItem('cellar-book:theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    if (pref === 'auto') localStorage.removeItem('cellar-book:theme');
    else localStorage.setItem('cellar-book:theme', pref);
  } catch {
    /* preference just won't persist */
  }
}
