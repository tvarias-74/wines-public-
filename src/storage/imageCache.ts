import { getImage } from './images';

/**
 * Hands out object URLs for stored photos. URLs are shared between the places that show the same
 * photo and are released shortly after the last one stops, so memory doesn't grow as you scroll.
 */

type Kind = 'thumb' | 'full';

interface Entry {
  url: Promise<string | null>;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}

const entries = new Map<string, Entry>();
const KEEP_MS: Record<Kind, number> = { thumb: 5 * 60_000, full: 20_000 };

const keyOf = (id: string, kind: Kind) => `${kind}:${id}`;

async function load(id: string, kind: Kind): Promise<string | null> {
  try {
    const img = await getImage(id);
    if (!img) return null;
    return URL.createObjectURL(kind === 'thumb' ? img.thumb : img.full);
  } catch {
    return null;
  }
}

export function acquireImageUrl(id: string, kind: Kind): Promise<string | null> {
  const key = keyOf(id, kind);
  let e = entries.get(key);
  if (!e) {
    const fresh: Entry = { url: load(id, kind), refs: 0 };
    e = fresh;
    entries.set(key, fresh);
    // A photo that could not be read (a hiccup, or it arrives with a restore a moment later) is looked for again next time.
    void fresh.url.then((u) => {
      if (u === null && entries.get(key) === fresh) entries.delete(key);
    });
  }
  if (e.timer) clearTimeout(e.timer);
  e.timer = undefined;
  e.refs++;
  return e.url;
}

export function releaseImageUrl(id: string, kind: Kind): void {
  const key = keyOf(id, kind);
  const e = entries.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs > 0) return;
  e.timer = setTimeout(() => {
    if (e.refs > 0) return;
    entries.delete(key);
    void e.url.then((u) => u && URL.revokeObjectURL(u));
  }, KEEP_MS[kind]);
}

/** Forget what we know about a photo (after it has been replaced or deleted). */
export function forgetImage(id: string): void {
  for (const kind of ['thumb', 'full'] as const) {
    const key = keyOf(id, kind);
    const e = entries.get(key);
    if (!e) continue;
    entries.delete(key);
    void e.url.then((u) => u && URL.revokeObjectURL(u));
  }
}
