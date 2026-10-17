import { describe, expect, it } from 'vitest';
import { addBarcode, addWine, removeBarcode } from './actions';
import { barcodeProblem, formatBarcode, hasValidCheckDigit, normalizeBarcode } from './barcode';
import { buildRows, filterRows, rowsForBarcode } from './inventory';
import { exportInventoryCsv, importInventoryCsv, parseBackup, serializeBackup, validateData } from './portability';
import { add, emptyData, NOW, wine } from './helpers.test-util';

// Real, valid numbers: an EAN-13, a UPC-A, an EAN-8 and the same UPC-A as an EAN-13.
const EAN13 = '3017620422003';
const OTHER13 = '5901234123457';
const UPCA = '036000291452';
const EAN8 = '96385074';

describe('what counts as a bottle barcode', () => {
  it('accepts EAN-13, UPC-A and EAN-8 with a matching check digit', () => {
    expect(normalizeBarcode(EAN13)).toBe(EAN13);
    expect(normalizeBarcode(EAN8)).toBe(EAN8);
    expect(hasValidCheckDigit(EAN13)).toBe(true);
    expect(hasValidCheckDigit('3017620422004')).toBe(false);
  });

  it('writes a UPC-A the way every other system does: as the EAN-13 with a leading zero', () => {
    expect(normalizeBarcode(UPCA)).toBe(`0${UPCA}`);
    expect(normalizeBarcode(`0${UPCA}`)).toBe(`0${UPCA}`); // a spreadsheet that dropped, or a scanner that added, the zero
  });

  it('ignores the spaces and hyphens people type', () => {
    expect(normalizeBarcode('3 017620 422003')).toBe(EAN13);
    expect(normalizeBarcode(' 3017-6204-22003 ')).toBe(EAN13);
  });

  it('refuses a misread digit, a wrong length, a carton code and letters, each with a reason', () => {
    expect(barcodeProblem('3017620422004')).toMatch(/last digit/);
    expect(barcodeProblem('30176204220')).toMatch(/13 digits/);
    expect(barcodeProblem('03017620422003')).toMatch(/carton/);
    expect(barcodeProblem('30176204220O3')).toMatch(/digits only/);
    expect(barcodeProblem('  ')).toMatch(/Enter/);
    expect(normalizeBarcode('3017620422004')).toBeNull();
    expect(barcodeProblem(EAN13)).toBeNull();
  });

  it('groups a barcode for display the way it is printed', () => {
    expect(formatBarcode(EAN13)).toBe('3 017620 422003');
    expect(formatBarcode(EAN8)).toBe(EAN8);
  });
});

describe('barcodes on a bottling', () => {
  it('are saved with a new wine, normalised, without repeats', () => {
    const r = addWine(emptyData(), { ...wine(), barcodes: [EAN13, '3 017620 422003', UPCA] }, undefined, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.bottlings[0]?.barcodes).toEqual([EAN13, `0${UPCA}`]);
  });

  it('refuse an invalid barcode on the form, pointing at the field', () => {
    const r = addWine(emptyData(), { ...wine(), barcodes: ['12345'] }, undefined, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.barcode).toBeDefined();
  });

  it('are added to a bottling you already have, and are shared by its vintages', () => {
    const first = add(emptyData(), { year: 2018 }, { quantity: 3 });
    const second = addWine(first.data, { ...wine({ year: 2019 }), barcodes: [EAN13] }, { quantity: 2 }, NOW);
    if (!second.ok) throw new Error(second.error);
    expect(second.data.bottlings).toHaveLength(1);
    expect(second.data.bottlings[0]?.barcodes).toEqual([EAN13]);
    const rows = rowsForBarcode(buildRows(second.data, NOW), EAN13);
    expect(rows.map((r) => r.vintage.year)).toEqual([2019, 2018]); // newest first; both vintages of the bottling
  });

  it('can be attached to and removed from a wine afterwards', () => {
    const { data, id } = add(emptyData(), {}, { quantity: 1 });
    const bottlingId = data.vintages.find((v) => v.id === id)!.bottlingId;
    const a = addBarcode(data, bottlingId, EAN13);
    if (!a.ok) throw new Error(a.error);
    expect(a.added).toBe(true);
    const again = addBarcode(a.data, bottlingId, EAN13);
    expect(again.ok && again.added).toBe(false);
    expect(again.ok && again.data).toBe(a.data); // nothing changed, nothing rewritten
    expect(addBarcode(data, bottlingId, 'nope').ok).toBe(false);
    expect(addBarcode(data, 'missing', EAN13).ok).toBe(false);
    const gone = removeBarcode(a.data, bottlingId, EAN13);
    expect(gone.bottlings[0]).not.toHaveProperty('barcodes');
  });

  it('may be shared by two bottlings, and the second is told about the first', () => {
    const a = add(emptyData(), { bottling: 'Cuvée A' }, { quantity: 1 });
    const b = add(a.data, { bottling: 'Cuvée B' }, { quantity: 1 });
    const bottlingOf = (d: typeof b.data, vid: string) => d.vintages.find((v) => v.id === vid)!.bottlingId;
    const first = addBarcode(b.data, bottlingOf(b.data, a.id), EAN13);
    if (!first.ok) throw new Error(first.error);
    const second = addBarcode(first.data, bottlingOf(b.data, b.id), EAN13);
    expect(second.ok && second.alsoOn.map((x) => x.name)).toEqual(['Cuvée A']);
    expect(rowsForBarcode(buildRows(second.ok ? second.data : b.data, NOW), EAN13)).toHaveLength(2);
  });

  it('are found by typing them into the cellar search', () => {
    const r = addWine(emptyData(), { ...wine(), barcodes: [EAN13] }, { quantity: 2 }, NOW);
    if (!r.ok) throw new Error(r.error);
    const rows = buildRows(r.data, NOW);
    expect(filterRows(rows, { query: EAN13 })).toHaveLength(1);
    expect(filterRows(rows, { query: '3 017620 422003' })).toHaveLength(1);
    expect(filterRows(rows, { query: OTHER13 })).toHaveLength(0);
  });
});

describe('barcodes in backups and spreadsheets', () => {
  it('survive a backup, and a stored invalid one is refused', () => {
    const r = addWine(emptyData(), { ...wine(), barcodes: [EAN13, OTHER13] }, { quantity: 1 }, NOW);
    if (!r.ok) throw new Error(r.error);
    const back = parseBackup(serializeBackup(r.data, NOW));
    expect(back.ok && back.data.bottlings[0]?.barcodes).toEqual([EAN13, OTHER13]);

    const doc = JSON.parse(serializeBackup(r.data, NOW));
    for (const bad of [['12345'], [EAN13, EAN13], 'nope', [3017620422003]]) {
      doc.bottlings[0].barcodes = bad;
      expect(() => validateData(doc), JSON.stringify(bad)).toThrow(/barcode/);
    }
  });

  it('an older (version 2) backup opens as version 3, with no barcodes and nothing changed', () => {
    const r = addWine(emptyData(), wine(), { quantity: 1 }, NOW);
    if (!r.ok) throw new Error(r.error);
    const v2 = { ...JSON.parse(serializeBackup(r.data, NOW)), schema: 2 };
    const data = validateData(v2);
    expect(data.schema).toBe(3);
    expect(data.bottlings[0]).not.toHaveProperty('barcodes');
  });

  it('go out in the CSV and come back in', () => {
    const r = addWine(emptyData(), { ...wine(), barcodes: [EAN13, OTHER13] }, { quantity: 4 }, NOW);
    if (!r.ok) throw new Error(r.error);
    const csv = exportInventoryCsv(r.data, ',', NOW);
    expect(csv.split('\n')[0]).toContain('barcode');
    const imported = importInventoryCsv(emptyData(), csv, NOW);
    expect(imported.data.bottlings[0]?.barcodes).toEqual([EAN13, OTHER13]);
  });

  it('are read from an EAN / GTIN / UPC column, and a spreadsheet’s mangled numbers are reported, not stored', () => {
    const csv = `Winery;Wine;Vintage;Colour;EAN;Bottles\nDomaine X;Cuvée;2019;red;${UPCA};2\nDomaine Y;Cuvée;2019;red;3.76E+12;1\n`;
    const imported = importInventoryCsv(emptyData(), csv, NOW);
    expect(imported.data.bottlings.find((b) => b.name === 'Cuvée' && b.barcodes)?.barcodes).toEqual([`0${UPCA}`]);
    expect(imported.data.bottlings.filter((b) => b.barcodes)).toHaveLength(1);
    expect(imported.warnings.join(' ')).toMatch(/1 barcode was not valid/);
  });
});
