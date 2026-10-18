import { describe, expect, it } from 'vitest';
import { setVintageImage } from '../domain/actions';
import { buildSampleData } from '../domain/sample';
import { emptyData } from '../domain/types';
import { keepOnlyImages, packBackup, packJsonBackup, unpackBackup, type BundleImage } from './bundle';
import { createZip } from './zip';

const jpeg = (n: number) => Uint8Array.from({ length: 300 }, (_, i) => (i + n) % 256);
const img = (id: string, n = 1): BundleImage => ({ id, full: jpeg(n), thumb: jpeg(n + 100) });

function cellar() {
  let data = buildSampleData(emptyData());
  const [a, b] = data.vintages;
  data = setVintageImage(data, a!.id, 'front', 'img-a-front');
  data = setVintageImage(data, a!.id, 'back', 'img-a-back');
  data = setVintageImage(data, b!.id, 'front', 'img-b-front');
  return { data, a: a!, b: b! };
}

describe('backup with photos', () => {
  it('round-trips the cellar and every photo exactly', async () => {
    const { data } = cellar();
    const photos = [img('img-a-front', 1), img('img-a-back', 2), img('img-b-front', 3)];
    const out = await unpackBackup(packBackup(data, photos));
    if (!out.ok) throw new Error(out.error);
    expect(out.format).toBe('zip');
    expect(out.warnings).toEqual([]);
    expect(out.data).toEqual(data);
    expect(out.images.map((i) => i.id).sort()).toEqual(['img-a-back', 'img-a-front', 'img-b-front']);
    const front = out.images.find((i) => i.id === 'img-a-front')!;
    expect(Array.from(front.full)).toEqual(Array.from(jpeg(1)));
    expect(Array.from(front.thumb)).toEqual(Array.from(jpeg(101)));
  });

  it('never writes a reference to a photo it does not contain', async () => {
    const { data, a } = cellar();
    const out = await unpackBackup(packBackup(data, [img('img-a-front')]));
    if (!out.ok) throw new Error(out.error);
    expect(out.data.vintages.find((v) => v.id === a.id)?.images).toEqual({ front: 'img-a-front' });
    expect(out.data.vintages.filter((v) => v.images)).toHaveLength(1);
  });

  it('reports photos that are missing from a file whose cellar mentions them', async () => {
    const { data, a } = cellar();
    const full = packBackup(data, [img('img-a-front'), img('img-a-back'), img('img-b-front')]);
    // rebuild the archive without one photo but with the original cellar.json
    const { readZip } = await import('./zip');
    const entries = (await readZip(full)).filter((e) => !e.name.includes('img-a-back'));
    const out = await unpackBackup(createZip(entries));
    if (!out.ok) throw new Error(out.error);
    expect(out.warnings.join(' ')).toMatch(/1 label photo was missing/);
    expect(out.data.vintages.find((v) => v.id === a.id)?.images).toEqual({ front: 'img-a-front' });
  });

  it('uses the full image when an archive has no thumbnail', async () => {
    const { data } = cellar();
    const { readZip } = await import('./zip');
    const entries = (await readZip(packBackup(data, [img('img-a-front')]))).filter((e) => !e.name.endsWith('.thumb.jpg'));
    const out = await unpackBackup(createZip(entries));
    if (!out.ok) throw new Error(out.error);
    expect(Array.from(out.images[0]!.thumb)).toEqual(Array.from(out.images[0]!.full));
  });

  it('ignores files with unsafe names', async () => {
    const { data } = cellar();
    const { readZip } = await import('./zip');
    const entries = await readZip(packBackup(data, [img('img-a-front')]));
    const sneaky = [...entries, { name: 'images/../../evil.jpg', data: jpeg(9) }, { name: 'images/a b.jpg', data: jpeg(9) }, { name: 'other/x.jpg', data: jpeg(9) }];
    const out = await unpackBackup(createZip(sneaky));
    if (!out.ok) throw new Error(out.error);
    expect(out.images.map((i) => i.id)).toEqual(['img-a-front']);
  });

  it('refuses archives that are damaged, empty of a cellar, or hold an invalid one', async () => {
    const { data } = cellar();
    const zip = packBackup(data, [img('img-a-front')]);
    const damaged = zip.slice();
    damaged[200] = (damaged[200] ?? 0) ^ 0xff; // inside cellar.json's data
    expect((await unpackBackup(damaged)).ok).toBe(false);
    const noData = await unpackBackup(createZip([{ name: 'images/a.jpg', data: jpeg(1) }]));
    expect(noData).toMatchObject({ ok: false, error: expect.stringMatching(/cellar\.json/) });
    const badData = await unpackBackup(createZip([{ name: 'cellar.json', data: new TextEncoder().encode('{"schema":2}') }]));
    expect(badData.ok).toBe(false);
  });
});

describe('backup without photos', () => {
  it('is plain JSON that still names the photos, without carrying them', async () => {
    const { data } = cellar();
    const json = packJsonBackup(data);
    expect(json).toContain('img-a-front');
    const elsewhere = await unpackBackup(new TextEncoder().encode(json));
    if (!elsewhere.ok) throw new Error(elsewhere.error);
    expect(elsewhere.format).toBe('json');
    expect(elsewhere.images).toEqual([]);
    expect(elsewhere.data.vintages.some((v) => v.images)).toBe(false); // nothing dangles on a device without the pictures
    expect(elsewhere.warnings.join(' ')).toMatch(/no photos/);
  });

  it('restored on the device that still holds the pictures, links them again with no warning', async () => {
    const { data } = cellar();
    const here = new Set(['img-a-front', 'img-a-back', 'img-b-front']);
    const out = await unpackBackup(new TextEncoder().encode(packJsonBackup(data)), (id) => here.has(id));
    if (!out.ok) throw new Error(out.error);
    expect(out.warnings).toEqual([]);
    expect(out.data.vintages.filter((v) => v.images)).toHaveLength(2);
  });

  it('keeps a reference only when the photo is already on this device', async () => {
    const { data, a } = cellar();
    const withRefs = new TextEncoder().encode(JSON.stringify(data));
    const out = await unpackBackup(withRefs, (id) => id === 'img-a-front');
    if (!out.ok) throw new Error(out.error);
    expect(out.data.vintages.find((v) => v.id === a.id)?.images).toEqual({ front: 'img-a-front' });
    expect(out.warnings.join(' ')).toMatch(/no photos/);
  });

  it('rejects things that are not backups', async () => {
    for (const text of ['', 'hello', '[]', '{}']) expect((await unpackBackup(new TextEncoder().encode(text))).ok, text).toBe(false);
  });

  it('keepOnlyImages leaves untouched data identical', () => {
    const data = buildSampleData(emptyData());
    expect(keepOnlyImages(data, new Set())).toBe(data);
  });
});

describe('an archive that was opened and zipped again', () => {
  it('still restores when everything sits inside one folder', async () => {
    const { data } = cellar();
    const zip = packBackup(data, [img('img-a-front'), img('img-a-back'), img('img-b-front')]);
    const entries = await (await import('./zip')).readZip(zip);
    const wrapped = createZip(entries.map((e) => ({ name: `Cellar Book backup/${e.name}`, data: e.data })));
    const out = await unpackBackup(wrapped);
    if (!out.ok) throw new Error(out.error);
    expect(out.images.map((i) => i.id).sort()).toEqual(['img-a-back', 'img-a-front', 'img-b-front']);
    expect(out.warnings).toEqual([]);
  });
});
