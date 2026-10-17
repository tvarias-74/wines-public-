import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, createZip, looksLikeZip, readZip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zip round trip', () => {
  it('stores and returns every file byte for byte, including binary and non-ASCII names', async () => {
    const binary = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7 + 3) % 256);
    const zip = createZip([
      { name: 'cellar.json', data: bytes('{"hello":"wörld"}') },
      { name: 'images/a-b_1.jpg', data: binary },
      { name: 'images/Château é.jpg', data: bytes('x') },
      { name: 'empty.txt', data: new Uint8Array() },
    ]);
    expect(looksLikeZip(zip)).toBe(true);
    const back = await readZip(zip);
    expect(back.map((e) => e.name)).toEqual(['cellar.json', 'images/a-b_1.jpg', 'images/Château é.jpg', 'empty.txt']);
    expect(text(back[0]!.data)).toBe('{"hello":"wörld"}');
    expect(Array.from(back[1]!.data)).toEqual(Array.from(binary));
    expect(back[3]!.data.length).toBe(0);
  });

  it('reads a real zip made by another tool: deflated, with extra fields and a comment', async () => {
    const payload = bytes('Producer,Bottling\n'.repeat(200));
    const deflated = new Uint8Array(deflateRawSync(payload));
    const name = bytes('data.csv');
    const crc = crc32(payload);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true); // deflate
    local.setUint32(14, crc, true);
    local.setUint32(18, deflated.length, true);
    local.setUint32(22, payload.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 4, true); // an extra field
    const extra = new Uint8Array([1, 2, 3, 4]);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, deflated.length, true);
    cd.setUint32(24, payload.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 4, true);
    const localLen = 30 + name.length + 4 + deflated.length;
    const comment = bytes('made elsewhere');
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + name.length + 4, true);
    end.setUint32(16, localLen, true);
    end.setUint16(20, comment.length, true);
    const parts = [new Uint8Array(local.buffer), name, extra, deflated, new Uint8Array(cd.buffer), name, extra, new Uint8Array(end.buffer), comment];
    const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { zip.set(p, at); at += p.length; }
    const [entry] = await readZip(zip);
    expect(entry?.name).toBe('data.csv');
    expect(text(entry!.data)).toBe(text(payload));
  });

  it('refuses a file whose contents were damaged, rather than restoring wrong data', async () => {
    const zip = createZip([{ name: 'cellar.json', data: bytes('{"a":1}') }]);
    const broken = zip.slice();
    const at = 30 + 'cellar.json'.length + 2;
    broken[at] = (broken[at] ?? 0) ^ 0xff; // flip a byte of the file's data
    await expect(readZip(broken)).rejects.toThrow(/checksum|damaged/);
  });

  it('refuses a truncated file and non-zip input', async () => {
    const zip = createZip([{ name: 'a.txt', data: bytes('hello world') }]);
    await expect(readZip(zip.slice(0, zip.length - 10))).rejects.toThrow(/damaged/);
    await expect(readZip(bytes('{"not":"a zip"}'))).rejects.toThrow(/not a ZIP/);
    await expect(readZip(new Uint8Array())).rejects.toThrow();
  });

  it('refuses encrypted archives and unknown compression instead of producing garbage', async () => {
    const zip = createZip([{ name: 'a.txt', data: bytes('x') }]);
    const encrypted = zip.slice();
    const view = new DataView(encrypted.buffer);
    const cdAt = view.getUint32(encrypted.length - 22 + 16, true);
    view.setUint16(cdAt + 8, 1, true);
    await expect(readZip(encrypted)).rejects.toThrow(/encrypted/);
    const odd = zip.slice();
    new DataView(odd.buffer).setUint16(new DataView(odd.buffer).getUint32(odd.length - 22 + 16, true) + 10, 99, true);
    await expect(readZip(odd)).rejects.toThrow(/compression method/);
  });

  it('does not trust a file that lies about its own size (zip bomb guard)', async () => {
    const payload = bytes('A'.repeat(100_000));
    const bomb = createZip([{ name: 'a.txt', data: payload }]);
    // pretend it is deflated, claiming a tiny size
    const view = new DataView(bomb.buffer);
    const cdAt = view.getUint32(bomb.length - 22 + 16, true);
    view.setUint16(cdAt + 10, 8, true);
    view.setUint32(cdAt + 24, 5, true);
    await expect(readZip(bomb)).rejects.toThrow();
  });
});
