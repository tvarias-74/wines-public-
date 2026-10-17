import type { CellarData } from '../domain/types';
import { referencedImageIds } from '../domain/actions';
import { toIsoDate } from '../domain/text';
import { packBackup, packJsonBackup, unpackBackup, type BundleImage, type Unpacked } from './bundle';
import { blobBytes, getImages, listImages, putImages } from './images';

/** Glue between the pure backup format and the photo store. */

export interface BackupFile {
  blob: Blob;
  filename: string;
  /** Photos inside the file. */
  photos: number;
}

export async function createBackupFile(data: CellarData, includePhotos: boolean, now: Date = new Date()): Promise<BackupFile> {
  const day = toIsoDate(now);
  const ids = [...referencedImageIds(data)];
  if (includePhotos && ids.length) {
    const stored = await getImages(ids);
    const images: BundleImage[] = [];
    for (const s of stored) images.push({ id: s.id, full: await blobBytes(s.full), thumb: await blobBytes(s.thumb) });
    const zip = packBackup(data, images, now);
    return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), filename: `cellar-book-backup-${day}.zip`, photos: images.length };
  }
  return { blob: new Blob([packJsonBackup(data, now)], { type: 'application/json' }), filename: `cellar-book-backup-${day}.json`, photos: 0 };
}

export async function readBackupFile(file: Blob): Promise<Unpacked> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const local = new Set((await listImages()).map((i) => i.id));
  return unpackBackup(bytes, (id) => local.has(id));
}

/** Adds a backup's photos to the photo store. Done before the cellar is replaced, so a failure here changes nothing. */
export async function storeBackupImages(images: BundleImage[]): Promise<void> {
  if (!images.length) return;
  const now = Date.now();
  await putImages(
    images.map((i) => ({
      id: i.id,
      full: new Blob([i.full as BlobPart], { type: 'image/jpeg' }),
      thumb: new Blob([i.thumb as BlobPart], { type: 'image/jpeg' }),
      width: 0,
      height: 0,
      createdAt: now,
    })),
  );
}

export async function photoStats(): Promise<{ count: number; bytes: number }> {
  const all = await listImages();
  return { count: all.length, bytes: all.reduce((n, i) => n + i.bytes, 0) };
}
