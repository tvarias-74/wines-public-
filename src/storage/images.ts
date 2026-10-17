import { IMAGE_STORE, openDb } from './storage';

/**
 * Label photos live in their own IndexedDB store, apart from the cellar document, which would
 * otherwise balloon. Each photo is a full-size JPEG plus a small thumbnail for lists.
 */

export interface StoredImage {
  id: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  createdAt: number;
  /** When a cleanup pass first found no wine using this photo. Cleared again as soon as one does. */
  unusedSince?: number;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (v: T) => void, fail: (e: unknown) => void) => void): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, mode);
      let result: T;
      run(tx.objectStore(IMAGE_STORE), (v) => (result = v), reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('The photo store failed'));
      tx.onabort = () => reject(tx.error ?? new Error('The photo store was interrupted (is the device out of space?)'));
    });
  } finally {
    db.close();
  }
}

export function putImages(images: StoredImage[]): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    for (const img of images) store.put(img, img.id);
  });
}

export const putImage = (image: StoredImage) => putImages([image]);

export function getImage(id: string): Promise<StoredImage | undefined> {
  return withStore<StoredImage | undefined>('readonly', (store, done) => {
    const req = store.get(id);
    req.onsuccess = () => done(req.result as StoredImage | undefined);
  });
}

export function getImages(ids: string[]): Promise<StoredImage[]> {
  return withStore<StoredImage[]>('readonly', (store, done) => {
    const out: StoredImage[] = [];
    let pending = ids.length;
    if (pending === 0) done(out);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) out.push(req.result as StoredImage);
        if (--pending === 0) done(out);
      };
    }
  });
}

export function deleteImage(id: string): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    store.delete(id);
  });
}

export function listImages(): Promise<{ id: string; createdAt: number; bytes: number }[]> {
  return withStore('readonly', (store, done) => {
    const out: { id: string; createdAt: number; bytes: number }[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done(out);
      const v = cursor.value as StoredImage;
      out.push({ id: String(cursor.key), createdAt: v.createdAt ?? 0, bytes: (v.full?.size ?? 0) + (v.thumb?.size ?? 0) });
      cursor.continue();
    };
  });
}

/**
 * A photo nobody refers to is only deleted after being unused for this long. "Unused" is judged from
 * the cellar in memory, which can be momentarily wrong (a backup restored without photos, an old copy
 * loaded, a replaced cellar), so a deletion must never be the first thing that happens when the
 * cellar changes: the photo is only marked, and the mark is cleared the moment a wine uses it again.
 */
export const UNUSED_QUARANTINE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CleanupPlan {
  /** Newly found unused: start their clock. */
  mark: string[];
  /** In use again: reset their clock. */
  unmark: string[];
  /** Unused for the whole quarantine: delete. */
  remove: string[];
}

/** Decides what a cleanup pass does. Pure, so the rules can be tested without a browser. */
export function planCleanup(images: { id: string; unusedSince?: number }[], referenced: Set<string>, now: number): CleanupPlan {
  const plan: CleanupPlan = { mark: [], unmark: [], remove: [] };
  for (const i of images) {
    if (referenced.has(i.id)) {
      if (i.unusedSince !== undefined) plan.unmark.push(i.id);
    } else if (i.unusedSince === undefined || i.unusedSince > now) {
      plan.mark.push(i.id);
    } else if (now - i.unusedSince >= UNUSED_QUARANTINE_MS) {
      plan.remove.push(i.id);
    }
  }
  return plan;
}

/** One cleanup pass over the photo store. Returns how many photos were deleted. */
export function collectUnusedImages(referenced: Set<string>, now = Date.now()): Promise<number> {
  return withStore<number>('readwrite', (store, done) => {
    let removed = 0;
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done(removed);
      const img = cursor.value as StoredImage;
      const id = String(cursor.key);
      const plan = planCleanup([{ id, unusedSince: img.unusedSince }], referenced, now);
      if (plan.remove.length) {
        cursor.delete();
        removed++;
      } else if (plan.mark.length) {
        cursor.update({ ...img, unusedSince: now });
      } else if (plan.unmark.length) {
        const { unusedSince: _cleared, ...rest } = img;
        cursor.update(rest);
      }
      cursor.continue();
    };
  });
}

/** Removes every photo at once. Only for "delete everything", which the user has confirmed. */
export function deleteAllImages(): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    store.clear();
  });
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
