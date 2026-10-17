import type { CellarData } from '../domain/types';
import { parseBackup, serializeBackup } from '../domain/portability';
import { referencedImageIds } from '../domain/actions';
import { decodeText } from '../domain/text';
import { createZip, looksLikeZip, readZip } from './zip';

/**
 * A backup is either a plain `.json` (wines only) or a `.zip` holding `cellar.json` plus the label
 * photos as `images/<id>.jpg` (full size) and `images/<id>.thumb.jpg`. Nothing here touches storage:
 * packing and unpacking are pure, so a bad file is rejected before anything is changed.
 */

export interface BundleImage {
  id: string;
  full: Uint8Array;
  thumb: Uint8Array;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const DATA_FILE = 'cellar.json';

/** Drops photo references that have nothing behind them, so no wine claims a picture it doesn't have. */
export function keepOnlyImages(data: CellarData, available: Set<string>): CellarData {
  let changed = false;
  const vintages = data.vintages.map((v) => {
    if (!v.images) return v;
    const front = v.images.front && available.has(v.images.front) ? v.images.front : undefined;
    const back = v.images.back && available.has(v.images.back) ? v.images.back : undefined;
    if (front === v.images.front && back === v.images.back) return v;
    changed = true;
    const { images: _dropped, ...rest } = v;
    return front || back ? { ...rest, images: { ...(front ? { front } : {}), ...(back ? { back } : {}) } } : rest;
  });
  return changed ? { ...data, vintages } : data;
}

export function packBackup(data: CellarData, images: BundleImage[], now: Date = new Date()): Uint8Array {
  const usable = images.filter((i) => SAFE_ID.test(i.id));
  const cleaned = keepOnlyImages(data, new Set(usable.map((i) => i.id)));
  const enc = new TextEncoder();
  return createZip([
    { name: DATA_FILE, data: enc.encode(serializeBackup(cleaned, now)) },
    ...usable.flatMap((i) => [
      { name: `images/${i.id}.jpg`, data: i.full },
      { name: `images/${i.id}.thumb.jpg`, data: i.thumb },
    ]),
  ]);
}

/**
 * The same cellar as plain JSON. The photo references stay in it, although the pictures are not in the
 * file: restoring on this device finds the pictures that are still here and links them again, and
 * restoring anywhere else drops the references it can't back (and says so), so nothing dangles.
 */
export function packJsonBackup(data: CellarData, now: Date = new Date()): string {
  return serializeBackup(data, now);
}

export type Unpacked =
  | { ok: true; data: CellarData; images: BundleImage[]; warnings: string[]; format: 'zip' | 'json' }
  | { ok: false; error: string };

/**
 * Reads a backup file's bytes. Validates everything (the archive's checksums, the cellar's
 * structure and references) and reports what is missing, without changing anything.
 */
export async function unpackBackup(bytes: Uint8Array, hasLocalImage: (id: string) => boolean = () => false): Promise<Unpacked> {
  const warnings: string[] = [];
  let jsonText: string;
  const images: BundleImage[] = [];
  let format: 'zip' | 'json' = 'json';

  if (looksLikeZip(bytes)) {
    format = 'zip';
    let entries;
    try {
      entries = await readZip(bytes);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'The ZIP file could not be read.' };
    }
    // An archive re-zipped by a desktop tool often has everything inside one folder: accept that.
    const folder = entries.some((e) => e.name === DATA_FILE) ? '' : (entries.find((e) => /^[^/]+\/cellar\.json$/.test(e.name))?.name.slice(0, -DATA_FILE.length) ?? '');
    const inside = (name: string) => (folder && name.startsWith(folder) ? name.slice(folder.length) : name);
    const file = entries.find((e) => inside(e.name) === DATA_FILE);
    if (!file) return { ok: false, error: 'This ZIP file does not contain a Cellar Book backup (there is no cellar.json inside).' };
    jsonText = decodeText(file.data).text;
    const fulls = new Map<string, Uint8Array>();
    const thumbs = new Map<string, Uint8Array>();
    for (const e of entries) {
      const m = /^images\/([^/]+?)(\.thumb)?\.jpg$/.exec(inside(e.name));
      if (!m || !SAFE_ID.test(m[1] as string)) continue;
      (m[2] ? thumbs : fulls).set(m[1] as string, e.data);
    }
    for (const [id, full] of fulls) images.push({ id, full, thumb: thumbs.get(id) ?? full });
  } else {
    jsonText = decodeText(bytes).text.replace(/^﻿/, '');
  }

  const parsed = parseBackup(jsonText);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const wanted = referencedImageIds(parsed.data);
  const have = new Set([...images.map((i) => i.id), ...[...wanted].filter(hasLocalImage)]);
  const missing = [...wanted].filter((id) => !have.has(id));
  if (missing.length) {
    warnings.push(
      format === 'zip'
        ? `${missing.length} label photo${missing.length === 1 ? ' was' : 's were'} missing from the file and will be left out.`
        : `This backup has no photos, so wines whose photos aren’t already on this device will have none.`,
    );
  }
  return { ok: true, data: keepOnlyImages(parsed.data, have), images: images.filter((i) => wanted.has(i.id)), warnings, format };
}
