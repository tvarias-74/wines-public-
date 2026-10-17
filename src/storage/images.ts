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

/** Photos taken but not (yet) attached to a saved wine are kept this long before being cleaned up. */
export const ORPHAN_GRACE_MS = 10 * 60 * 1000;

/** Deletes photos that no wine refers to, unless they are brand new. Returns how many were removed. */
export async function collectUnusedImages(referenced: Set<string>, now = Date.now()): Promise<number> {
  const all = await listImages();
  const doomed = all.filter((i) => !referenced.has(i.id) && now - i.createdAt > ORPHAN_GRACE_MS).map((i) => i.id);
  if (doomed.length) {
    await withStore<void>('readwrite', (store) => {
      for (const id of doomed) store.delete(id);
    });
  }
  return doomed.length;
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
