import { describe, expect, it } from 'vitest';
import { addWine, hasSampleData, needsBackup, removeSampleData, updateWine } from './actions';
import { toCsv, parseCsvRows } from './csv';
import { buildRows, computeStats, filterRows } from './inventory';
import { exportInventoryCsv, importInventoryCsv, parseGrapes, parseSize, parseWineType } from './portability';
import { buildSampleData } from './sample';
import { decodeText, normalizeText } from './text';
import { add, drink, emptyData, NOW, wine } from './helpers.test-util';

describe('names that differ only in punctuation are the same name', () => {
  it('folds curly apostrophes, dash variants, ampersands and ligatures', () => {
    expect(normalizeText('Château d’Yquem')).toBe(normalizeText("Château d'Yquem"));
    expect(normalizeText('Domaine Jean‑Luc Colombo')).toBe(normalizeText('Domaine Jean-Luc Colombo'));
    expect(normalizeText('Jean – Luc')).toBe(normalizeText('Jean - Luc'));
    expect(normalizeText('Moët & Chandon')).toBe(normalizeText('Moët and Chandon'));
    expect(normalizeText('Lœwen')).toBe(normalizeText('Loewen'));
    expect(normalizeText('Weißburgunder')).toBe(normalizeText('Weissburgunder'));
  });
  it('so a winery typed on a phone with smart punctuation is not duplicated', () => {
    let { data } = add(emptyData(), { producer: "Château d'Yquem", bottling: 'Sauternes', year: 2015 }, { quantity: 1 });
    ({ data } = add(data, { producer: 'Château d’Yquem', bottling: 'Sauternes', year: 2016 }, { quantity: 1 }));
    expect(data.producers).toHaveLength(1);
    expect(data.bottlings).toHaveLength(1);
  });
  it('still tells genuinely different names apart', () => {
    expect(normalizeText("d'Yquem")).not.toBe(normalizeText('dYquem'));
    expect(normalizeText('Pinot Noir')).not.toBe(normalizeText('Pinot Gris'));
  });
});

describe('a bottling you already know is never overwritten by a later entry', () => {
  const known = () =>
    add(emptyData(), { producer: 'Dom X', bottling: 'Cuvee B', colour: 'red', country: 'France', region: 'Rhône', grapes: [{ grape: 'Syrah', percent: 100 }], year: 2016 }, { quantity: 2 });

  it('moving a vintage under it keeps its origin and grapes, whatever the moved wine said', () => {
    let { data } = known();
    const a = add(data, { producer: 'Dom X', bottling: 'Cuvee A', colour: 'white', country: 'Italy', region: 'Tuscany', grapes: [{ grape: 'Merlot' }], year: 2015 }, { quantity: 1 });
    const r = updateWine(a.data, a.id, wine({ producer: 'Dom X', bottling: 'Cuvee B', year: 2015, colour: 'white', country: 'Italy', region: 'Tuscany', grapes: [{ grape: 'Merlot' }] }), NOW);
    if (!r.ok) throw new Error(r.error);
    const b = r.data.bottlings.find((x) => x.name === 'Cuvee B')!;
    expect(b).toMatchObject({ colour: 'red', country: 'France', region: 'Rhône', grapes: [{ grape: 'Syrah', percent: 100 }] });
    expect(r.data.vintages.filter((v) => v.bottlingId === b.id)).toHaveLength(2);
  });

  it('adding a new vintage with different details does not change the shared bottling', () => {
    const { data } = known();
    const r = addWine(data, wine({ producer: 'Dom X', bottling: 'Cuvee B', year: 2017, colour: 'white', country: 'Spain', grapes: [{ grape: 'Merlot' }] }), { quantity: 1 }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings[0]).toMatchObject({ colour: 'red', country: 'France', grapes: [{ grape: 'Syrah', percent: 100 }] });
  });

  it('but blanks are filled in', () => {
    let { data } = add(emptyData(), { producer: 'Dom X', bottling: 'Cuvee B', year: 2016 }, { quantity: 1 });
    const r = addWine(data, wine({ producer: 'Dom X', bottling: 'Cuvee B', year: 2017, colour: 'red', region: 'Rhône', grapes: [{ grape: 'Syrah' }] }), { quantity: 1 }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings[0]).toMatchObject({ colour: 'red', region: 'Rhône', grapes: [{ grape: 'Syrah' }] });
  });

  it('editing a wine in place is how a bottling’s details are changed, for all its vintages', () => {
    const { data, id } = known();
    const r = updateWine(data, id, wine({ producer: 'Dom X', bottling: 'Cuvee B', year: 2016, colour: 'red', country: 'France', region: 'Languedoc', grapes: [{ grape: 'Syrah' }] }), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings[0]?.region).toBe('Languedoc');
  });

  it('a CSV row with no colour, or an unreadable one, leaves a red wine red', () => {
    const { data } = known();
    for (const csv of ['Producer,Bottling,Vintage,Bottles\nDom X,Cuvee B,2016,2', 'Producer,Bottling,Vintage,Colour,Bottles\nDom X,Cuvee B,2016,purple,2']) {
      const r = importInventoryCsv(data, csv, NOW);
      expect(buildRows(r.data, NOW)[0]?.bottling.colour, csv).toBe('red');
      expect(buildRows(r.data, NOW)[0]?.bottles).toBe(4);
    }
  });

  it('a CSV row cannot flip a sparkling bottling to still by leaving the column out', () => {
    const { data } = add(emptyData(), { producer: 'Maison', bottling: 'Brut', sparkling: true, year: null }, { quantity: 1 });
    const r = importInventoryCsv(data, 'Producer,Bottling,Vintage,Bottles\nMaison,Brut,NV,2', NOW);
    expect(buildRows(r.data, NOW)[0]?.bottling.sparkling).toBe(true);
  });
});

describe('cost of what is in stock', () => {
  it('only values the bottles that were actually priced', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 2, unitPrice: 100 });
    const more = addWine(data, wine(), { quantity: 3 }, NOW);
    if (!more.ok) throw new Error(more.error);
    const s = computeStats(buildRows(more.data, NOW));
    expect(s.bottles).toBe(5);
    expect(s.pricedBottles).toBe(2);
    expect(s.unpricedBottles).toBe(3);
    expect(s.costOfStock).toBe(200); // not 500
    // drinking an unpriced bottle changes nothing about what was paid
    expect(id).toBeTruthy();
  });
  it('after drinking, never claims more priced bottles than are left', () => {
    let { data, id } = add(emptyData(), {}, { quantity: 4, unitPrice: 50 });
    data = drink(data, id, 3);
    const s = computeStats(buildRows(data, NOW));
    expect(s).toMatchObject({ bottles: 1, pricedBottles: 1, unpricedBottles: 0, costOfStock: 50 });
  });
});

describe('demo wines that become yours', () => {
  it('adding bottles to a demo wine, or drinking one, makes it yours: removing the demo keeps it', () => {
    const demo = buildSampleData(emptyData());
    const gevrey = demo.vintages.find((v) => demo.bottlings.find((b) => b.id === v.bottlingId)?.name.startsWith('Gevrey') && v.year === 2019)!;
    const bottling = demo.bottlings.find((b) => b.id === gevrey.bottlingId)!;
    const producer = demo.producers.find((p) => p.id === bottling.producerId)!;
    const r = addWine(demo, wine({ producer: producer.name, bottling: bottling.name, year: 2019 }), { quantity: 6, unitPrice: 70 }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.vintageId).toBe(gevrey.id); // merged into the demo wine, which keeps its demo id
    const kept = removeSampleData(r.data);
    expect(kept.vintages.map((v) => v.id)).toEqual([gevrey.id]);
    expect(buildRows(kept, NOW)[0]?.bottles).toBe(12); // 6 demo + 6 yours; the whole wine is yours now
    expect(needsBackup(r.data, NOW)).toBe(true);
    expect(hasSampleData(kept)).toBe(false);
  });
  it('an untouched demo is still all removable, and does not ask for a backup', () => {
    const demo = buildSampleData(emptyData());
    expect(hasSampleData(demo)).toBe(true);
    expect(needsBackup(demo, NOW)).toBe(false);
    expect(removeSampleData(demo).vintages).toHaveLength(0);
  });
});

describe('CSV reading', () => {
  it('reads grape shares with a decimal comma instead of splitting them', () => {
    expect(parseGrapes('Merlot 12,5%; Syrah 87,5%')).toEqual([{ grape: 'Merlot', percent: 12.5 }, { grape: 'Syrah', percent: 87.5 }]);
    expect(parseGrapes('Merlot 60, Syrah 40')).toEqual([{ grape: 'Merlot 60' }, { grape: 'Syrah 40' }]); // no % → names, not shares
    expect(parseGrapes('Grenache, Syrah, Mourvèdre')).toHaveLength(3);
  });
  it('reports the real line of the file, not the row count', () => {
    const csv = 'Producer,Bottling,Vintage,Bottles\n\n\nA,B,2020,1\n"C\nmultiline",D,20x0,1\n';
    const r = importInventoryCsv(emptyData(), csv, NOW);
    expect(r.errors).toEqual([{ row: 5, message: expect.stringMatching(/Vintage/) }]);
    expect(parseCsvRows(csv).map((x) => x.line)).toEqual([1, 4, 5]);
  });
  it('line numbers survive Windows and old-Mac line endings', () => {
    expect(parseCsvRows('a,b\r\n\r\n1,2\r\n3,4').map((x) => x.line)).toEqual([1, 3, 4]);
    expect(parseCsvRows('a,b\r1,2\r\r3,4').map((x) => x.line)).toEqual([1, 2, 4]);
  });
  it('says so when vintages are missing rather than quietly calling the wines non-vintage', () => {
    const blank = importInventoryCsv(emptyData(), 'Producer,Bottling,Vintage,Bottles\nA,B,,1\nC,D,2020,1\nE,F,,1', NOW);
    expect(blank.warnings.join(' ')).toMatch(/2 rows have no vintage/);
    const none = importInventoryCsv(emptyData(), 'Producer,Bottling,Bottles\nA,B,1', NOW);
    expect(none.warnings.join(' ')).toMatch(/No “Vintage” column/);
    const fine = importInventoryCsv(emptyData(), 'Producer,Bottling,Vintage,Bottles\nA,B,NV,1', NOW);
    expect(fine.warnings.join(' ')).not.toMatch(/vintage/i);
  });
  it('does not mistake object property names for values', () => {
    expect(parseWineType('constructor')).toBeNull();
    expect(parseWineType('__proto__')).toBeNull();
    expect(parseSize('constructor')).toBeNull();
    expect(importInventoryCsv(emptyData(), 'Producer,Bottling,Size,Bottles\nA,B,constructor,1', NOW).errors[0]?.message).toMatch(/Bottle size/);
  });
  it('bottle size names agree with the labels in the app', () => {
    expect(parseSize('magnum')).toBe(1500);
    expect(parseSize('jeroboam')).toBe(3000);
    expect(parseSize('rehoboam')).toBe(4500);
    expect(parseSize('4.5L')).toBe(4500);
  });
});

describe('text encoding', () => {
  const bytes = (s: string, enc: 'utf8' | 'latin1' | 'utf16le') => new Uint8Array(Buffer.from(s, enc));
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(decodeText(bytes('Château Ε', 'utf8'))).toEqual({ text: 'Château Ε', encoding: 'utf-8' });
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])).text).toBe('A'); // the mark itself is dropped
  });
  it('reads an Excel "ANSI" CSV as Windows-1252 instead of producing "Ch�teau"', () => {
    const r = decodeText(bytes('Producer;Wine\nChâteau Léoville;Grüner', 'latin1'));
    expect(r.encoding).toBe('windows-1252');
    expect(r.text).toBe('Producer;Wine\nChâteau Léoville;Grüner');
    expect(r.text).not.toContain('�');
  });
  it('reads Excel "Unicode text" (UTF-16 with a BOM)', () => {
    const le = new Uint8Array([0xff, 0xfe, ...bytes('Château;1', 'utf16le')]);
    expect(decodeText(le)).toEqual({ text: 'Château;1', encoding: 'utf-16le' });
  });
  it('an ANSI file imports with its accents intact', () => {
    const { text } = decodeText(bytes('Producer,Wine,Bottles\nChâteau X,Cuvée,2', 'latin1'));
    const r = importInventoryCsv(emptyData(), text, NOW);
    expect(buildRows(r.data, NOW)[0]?.producer.name).toBe('Château X');
  });
});

describe('CSV writing', () => {
  it('neutralises every formula starter, including a leading minus, and the importer takes the guard off', () => {
    const out = toCsv([['=A1', '+1', '@x', '-2+3+cmd|\' /C calc\'!A0', 'plain', 5, -5]]).slice(1);
    expect(out).toBe("'=A1,'+1,'@x,'-2+3+cmd|' /C calc'!A0,plain,5,-5\r\n");
    const { data } = add(emptyData(), { producer: '-Dash Estate', bottling: '=Weird', year: 2020 }, { quantity: 1 });
    const csv = exportInventoryCsv(data, ',', NOW);
    expect(csv).toContain("'-Dash Estate");
    const back = importInventoryCsv(emptyData(), csv, NOW);
    expect(back.errors).toEqual([]);
    expect(buildRows(back.data, NOW)[0]).toMatchObject({ producer: { name: '-Dash Estate' }, bottling: { name: '=Weird' } });
  });
  it('writes decimals with a comma when the file is for a European-language spreadsheet', () => {
    const { data } = add(emptyData(), {}, { quantity: 2, unitPrice: 12.5 });
    const semi = exportInventoryCsv(data, ';', NOW);
    expect(semi).toContain(';12,5;');
    expect(semi).not.toContain(';12.5;');
    expect(exportInventoryCsv(data, ',', NOW)).toContain(',12.5,');
    // and either one reads back as the same price
    for (const csv of [semi, exportInventoryCsv(data, ',', NOW)]) {
      expect(buildRows(importInventoryCsv(emptyData(), csv, NOW).data, NOW)[0]?.avgPrice).toBe(12.5);
    }
  });
});

describe('searching', () => {
  it('finds a winery however its apostrophe was typed', () => {
    const { data } = add(emptyData(), { producer: 'Château d’Yquem', bottling: 'Sauternes' }, { quantity: 1 });
    const rows = buildRows(data, NOW);
    expect(filterRows(rows, { query: "d'yquem" })).toHaveLength(1);
    expect(filterRows(rows, { query: 'd’yquem' })).toHaveLength(1);
  });
});
