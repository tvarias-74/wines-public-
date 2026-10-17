import type { CellarData } from '../domain/types';

/**
 * The whole cellar is one JSON document, kept with a revision number that goes up on every save.
 * IndexedDB is the primary home; localStorage is a fallback for when IndexedDB refuses to work.
 *
 * Three rules keep this from ever losing data:
 *  1. "Nothing saved yet" and "I couldn't read what's saved" are different answers. The second
 *     never turns into an empty cellar that the next save would overwrite the real one with.
 *  2. Both stores carry the revision, and a load takes the newest, so a fallback write can never be
 *     shadowed by an older copy in the main store (or the other way round).
 *  3. A save only goes through if the stored revision is the one this tab last saw. A tab that has
 *     gone stale (asleep, restored from the back/forward cache) gets a clear error, not a silent overwrite.
 */

export const DB_NAME = 'cellar-book';
export const DB_VERSION = 2;
export const KV_STORE = 'kv';
export const IMAGE_STORE = 'images';
const DOC_KEY = 'cellar';
const REV_KEY = 'cellar-rev';
const LS_KEY = 'cellar-book:data';

export class StaleError extends Error {
  constructor() {
    super('The cellar was changed somewhere else since this page last looked.');
    this.name = 'StaleError';
  }
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('The database is blocked by another tab'));
  });
}

interface Stored {
  rev: number;
  raw: unknown;
}

/** A stored value is `{ rev, data }`; an older build stored the bare cellar, which counts as revision 0. */
function unwrap(value: unknown): Stored | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && 'rev' in value && 'data' in value && typeof (value as { rev: unknown }).rev === 'number') {
    return { rev: (value as { rev: number }).rev, raw: (value as { data: unknown }).data };
  }
  return { rev: 0, raw: value };
}

async function idbRead(): Promise<Stored | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(DOC_KEY);
      req.onsuccess = () => resolve(unwrap(req.result));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbReadRev(): Promise<number | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(REV_KEY);
      req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Writes in one transaction, and only if nobody saved since `expectedRev`. */
async function idbWrite(data: CellarData, expectedRev: number): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      const store = tx.objectStore(KV_STORE);
      let next = expectedRev + 1;
      let stale = false;
      const getRev = store.get(REV_KEY);
      getRev.onsuccess = () => {
        const stored = typeof getRev.result === 'number' ? getRev.result : 0;
        if (stored > expectedRev) {
          stale = true;
          tx.abort();
          return;
        }
        next = Math.max(stored, expectedRev) + 1;
        store.put({ rev: next, data }, DOC_KEY);
        store.put(next, REV_KEY);
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(stale ? new StaleError() : (tx.error ?? new Error('Write was aborted')));
      tx.onerror = () => {
        if (!stale) reject(tx.error ?? new Error('Write failed'));
      };
    });
  } finally {
    db.close();
  }
}

function lsRead(): Stored | undefined {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s === null ? undefined : unwrap(JSON.parse(s));
  } catch {
    return undefined;
  }
}

function lsRev(): number {
  return lsRead()?.rev ?? 0;
}

export type ReadResult =
  | { kind: 'empty' }
  | { kind: 'data'; raw: unknown; rev: number }
  /** Storage exists but could not be read, so we cannot know whether a cellar is in it. */
  | { kind: 'unreadable'; error: string };

/** What is saved, unvalidated. The newest of the two stores wins. */
export async function readStored(): Promise<ReadResult> {
  let idb: Stored | undefined;
  let idbError: unknown;
  try {
    idb = await idbRead();
  } catch (e) {
    idbError = e;
  }
  const ls = lsRead();
  const best = idb && ls ? (ls.rev > idb.rev ? ls : idb) : (idb ?? ls);
  if (best) return { kind: 'data', raw: best.raw, rev: best.rev };
  if (idbError !== undefined && typeof indexedDB !== 'undefined') {
    return { kind: 'unreadable', error: idbError instanceof Error ? idbError.message : String(idbError) };
  }
  return { kind: 'empty' };
}

/** The newest revision on disk, cheaply, or undefined when nothing is saved / readable. */
export async function readStoredRev(): Promise<number | undefined> {
  let rev: number | undefined;
  try {
    rev = await idbReadRev();
  } catch {
    /* fall back to the other store below */
  }
  const fromLs = lsRead()?.rev;
  if (rev === undefined) return fromLs;
  return fromLs !== undefined && fromLs > rev ? fromLs : rev;
}

export interface WriteResult {
  rev: number;
  /** True when IndexedDB failed and the save went to the fallback store instead. */
  usedFallback: boolean;
}

/** Saves, refusing (with a {@link StaleError}) if someone saved after `expectedRev`. */
export async function writeStored(data: CellarData, expectedRev: number): Promise<WriteResult> {
  try {
    const rev = await idbWrite(data, expectedRev);
    // The main store is the home again: an older fallback copy would only ever confuse a later load.
    try {
      if (lsRev() <= rev) localStorage.removeItem(LS_KEY);
    } catch {
      /* it will be superseded by revision anyway */
    }
    return { rev, usedFallback: false };
  } catch (e) {
    if (e instanceof StaleError) throw e;
    // IndexedDB failed: keep the work in localStorage, with a revision that beats whatever is in IndexedDB.
    try {
      const stored = lsRev();
      if (stored > expectedRev) throw new StaleError();
      const rev = Math.max(stored, expectedRev) + 1;
      localStorage.setItem(LS_KEY, JSON.stringify({ rev, data }));
      return { rev, usedFallback: true };
    } catch (lsError) {
      if (lsError instanceof StaleError) throw lsError;
      throw e instanceof Error ? e : new Error('Could not save');
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

// ---- barcode lookups (a per-device choice, like the theme: it is about this device's network use, not the cellar) ----

export type LookupPreference = 'ask' | 'auto';

/** Whether unknown barcodes are looked up online without asking each time. Off until the person turns it on. */
export function readLookupPreference(): LookupPreference {
  try {
    return localStorage.getItem('cellar-book:lookup') === 'auto' ? 'auto' : 'ask';
  } catch {
    return 'ask';
  }
}

export function writeLookupPreference(pref: LookupPreference): void {
  try {
    if (pref === 'auto') localStorage.setItem('cellar-book:lookup', 'auto');
    else localStorage.removeItem('cellar-book:lookup');
  } catch {
    /* the choice just won't persist */
  }
}
