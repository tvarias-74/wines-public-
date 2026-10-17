import { describe, expect, it } from 'vitest';
import { buildRows } from './inventory';
import {
  exportInventoryCsv, formatGrapes, importInventoryCsv, parseBackup, parseDateLoose, parseGrapes, parseNumber,
  parseColour, parseFizz, parseLocations, parseSize, parseStyle, parseWineType, serializeBackup,
} from './portability';
import { parseCsv } from './csv';
import { buildSampleData } from './sample';
import { add, drink, emptyData, NOW } from './helpers.test-util';

describe('backup', () => {
  it('round-trips the whole cellar losslessly', () => {
    let data = buildSampleData(emptyData());
    const extra = add(data, { producer: 'Unicode Ёж Κτήμα', bottling: 'Cuvée "Spéciale"', notes: 'multi\nline' }, { quantity: 2, unitPrice: 12.5, date: '2024' });
    data = drink(extra.data, extra.id, 1);
    const parsed = parseBackup(serializeBackup(data, NOW));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error();
    expect(parsed.data).toEqual(data);
  });

  it('rejects things that are not backups, with a useful message', () => {
    for (const bad of ['', 'not json', '[]', '{}', '{"schema":1}', '{"schema":99,"producers":[],"bottlings":[],"vintages":[],"purchases":[],"consumptions":[]}']) {
      const r = parseBackup(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });

  it('rejects dangling references and duplicate ids instead of importing a broken cellar', () => {
    const good = JSON.parse(serializeBackup(buildSampleData(emptyData()), NOW));
    const dangling = structuredClone(good);
    dangling.purchases[0].vintageId = 'does-not-exist';
    expect(parseBackup(JSON.stringify(dangling)).ok).toBe(false);
    const dup = structuredClone(good);
    dup.vintages.push({ ...dup.vintages[0] });
    expect(parseBackup(JSON.stringify(dup)).ok).toBe(false);
    const badType = structuredClone(good);
    badType.bottlings[0].colour = 'purple';
    expect(parseBackup(JSON.stringify(badType)).ok).toBe(false);
    const badDate = structuredClone(good);
    badDate.purchases[0].date = '2024-13-45';
    expect(parseBackup(JSON.stringify(badDate)).ok).toBe(false);
  });

  it('tolerates missing settings and meta (older or hand-edited files)', () => {
    const raw = JSON.parse(serializeBackup(emptyData(), NOW));
    delete raw.settings;
    delete raw.meta;
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok && r.data.settings.currency).toBe('EUR');
  });
});

describe('value parsers', () => {
  it('parses numbers in European and English formats', () => {
    const cases: [string, number | null][] = [
      ['12', 12], ['12.5', 12.5], ['12,5', 12.5], ['12,50', 12.5], ['€ 12,50', 12.5], ['$1,234.56', 1234.56],
      ['1.234,56', 1234.56], ['1,234', 1234], ['1.234.567', 1234567], ['0,99', 0.99], ['abc', null], ['', null], ['-3', -3],
      // one separator followed by exactly three digits is a thousands separator, whichever it is
      ['1.234', 1234], ['1.500', 1500], ['1,500', 1500], ['12.500', 12500], ['100.000', 100000],
      // …but anything else is a decimal part, and a leading zero is never a thousand
      ['10.25', 10.25], ['1.5', 1.5], ['0.750', 0.75], ['0,125', 0.125],
    ];
    for (const [input, want] of cases) expect(parseNumber(input), input).toBe(want);
  });
  it('parses dates, day first for slashed dates', () => {
    expect(parseDateLoose('2024-03-05')).toBe('2024-03-05');
    expect(parseDateLoose('05/03/2024')).toBe('2024-03-05');
    expect(parseDateLoose('5.3.2024')).toBe('2024-03-05');
    expect(parseDateLoose('2024/3/5')).toBe('2024-03-05');
    expect(parseDateLoose('03/2024')).toBe('2024-03');
    expect(parseDateLoose('2019')).toBe('2019');
    expect(parseDateLoose('2024-02-30')).toBeNull();
    expect(parseDateLoose('31/02/2024')).toBeNull();
    expect(parseDateLoose('last week')).toBeNull();
  });
  it('parses sizes', () => {
    expect(parseSize('750')).toBe(750);
    expect(parseSize('750ml')).toBe(750);
    expect(parseSize('75cl')).toBe(750);
    expect(parseSize('0.75 L')).toBe(750);
    expect(parseSize('1,5l')).toBe(1500);
    expect(parseSize('Magnum')).toBe(1500);
    expect(parseSize('75')).toBe(750);
    expect(parseSize('huge')).toBeNull();
  });
  it('reads colour, still/sparkling and style from the words people use', () => {
    expect(parseColour('Red')).toBe('red');
    expect(parseColour('Rosé')).toBe('rose');
    expect(parseColour('Blanc')).toBe('white');
    expect(parseColour('skin-contact')).toBe('orange');
    expect(parseColour('Ερυθρό')).toBe('red');
    expect(parseColour('purple')).toBeNull();
    expect(parseFizz('Sparkling')).toBe(true);
    expect(parseFizz('yes')).toBe(true);
    expect(parseFizz('Still')).toBe(false);
    expect(parseFizz('quiet')).toBe(false);
    expect(parseFizz('no')).toBe(false);
    expect(parseFizz('maybe')).toBeNull();
    expect(parseStyle('Port')).toBe('fortified');
    expect(parseStyle('Sauternes')).toBe('sweet');
    expect(parseStyle('dry')).toBeNull();
  });
  it('reads the old combined "Type" word as whatever it actually says', () => {
    expect(parseWineType('Red')).toEqual({ colour: 'red' });
    expect(parseWineType('Champagne')).toEqual({ sparkling: true });
    expect(parseWineType('Port')).toEqual({ style: 'fortified' });
    expect(parseWineType('Rosé')).toEqual({ colour: 'rose' });
    expect(parseWineType('purple')).toBeNull();
  });
  it('reads storage places, with or without counts', () => {
    expect(parseLocations('12')).toEqual([{ name: 'Division 12' }]);
    expect(parseLocations('Division 12: 6; 13: 3')).toEqual([{ name: 'Division 12', quantity: 6 }, { name: 'Division 13', quantity: 3 }]);
    expect(parseLocations('Wooden box A')).toEqual([{ name: 'Wooden box A' }]);
    expect(parseLocations('')).toEqual([]);
  });
  it('parses grape lists with and without percentages', () => {
    expect(parseGrapes('Merlot 60%; Cabernet Franc 40%')).toEqual([{ grape: 'Merlot', percent: 60 }, { grape: 'Cabernet Franc', percent: 40 }]);
    expect(parseGrapes('Grenache, Syrah, Mourvèdre')).toEqual([{ grape: 'Grenache' }, { grape: 'Syrah' }, { grape: 'Mourvèdre' }]);
    expect(parseGrapes('Cabernet Sauvignon: 70%/Merlot (30%)')).toEqual([{ grape: 'Cabernet Sauvignon', percent: 70 }, { grape: 'Merlot', percent: 30 }]);
    expect(parseGrapes('Pinot Noir')).toEqual([{ grape: 'Pinot Noir' }]);
    expect(parseGrapes('')).toEqual([]);
    expect(formatGrapes(parseGrapes('Merlot 60%; Franc'))).toBe('Merlot 60%; Franc');
  });
});

describe('CSV import', () => {
  const eu = [
    'Producer;Wine;Vintage;Type;Bottles;Price;Purchase date;Drink from;Drink to;Grapes;Notes',
    'Château Alpha;Grand Vin;2018;Rouge;6;"52,50";05/03/2021;2024;2035;"Merlot 70%; Cabernet Franc 30%";"first ""case"""',
    'Château Alpha;Grand Vin;2018;Rouge;3;60;12/11/2022;;;;',
    'Émile;Brut;NV;Champagne;2;;;;;;',
    ';Missing producer;2020;red;1;;;;;;',
    'Zeta;Riesling;20x5;white;1;;;;;;',
    'Zeta;Riesling;2020;white;two;;;;;;',
    'Zeta;Riesling;2020;white;1;cheap;;;;;',
    'Zeta;Riesling;2021;white;1;;31/02/2023;;;;',
    'Gamma;Sold Out;2015;red;0;;;;;;',
  ].join('\n');

  it('imports a European spreadsheet export and reports every row it could not use', () => {
    const r = importInventoryCsv(emptyData(), eu, NOW);
    expect(r.imported).toBe(4);
    expect(r.merged).toBe(1);
    expect(r.errors.map((e) => e.row)).toEqual([5, 6, 7, 8, 9]);
    expect(r.errors[0]!.message).toMatch(/producer/i);
    expect(r.errors[1]!.message).toMatch(/vintage/i);
    expect(r.errors[2]!.message).toMatch(/bottle count/i);
    expect(r.errors[3]!.message).toMatch(/price/i);
    expect(r.errors[4]!.message).toMatch(/date/i);

    const rows = buildRows(r.data, NOW);
    const alpha = rows.find((x) => x.producer.name === 'Château Alpha')!;
    expect(alpha).toMatchObject({ bottles: 9, purchased: 9, status: 'ready' });
    expect(alpha.vintage).toMatchObject({ drinkFrom: 2024, drinkTo: 2035, windowSource: 'manual', notes: 'first "case"' });
    expect(alpha.bottling).toMatchObject({ colour: 'red', sparkling: false });
    expect(alpha.bottling.grapes).toEqual([{ grape: 'Merlot', percent: 70 }, { grape: 'Cabernet Franc', percent: 30 }]);
    expect(alpha.avgPrice).toBeCloseTo((6 * 52.5 + 3 * 60) / 9);
    expect(alpha.firstPurchase).toBe('2021-03-05');
    const nv = rows.find((x) => x.producer.name === 'Émile')!;
    expect(nv.vintage.year).toBeNull();
    expect(nv.bottling.sparkling).toBe(true);
    expect(nv.bottling.colour).toBeUndefined(); // "Champagne" says sparkling, not a colour
    expect(nv.avgPrice).toBeNull();
    // a zero-bottle row creates the wine but no stock
    expect(rows.find((x) => x.producer.name === 'Gamma')?.bottles).toBe(0);
  });

  it('does not touch existing data when merging, and is additive', () => {
    const base = add(emptyData(), { producer: 'Château Alpha', bottling: 'Grand Vin', year: 2018 }, { quantity: 2 }).data;
    const r = importInventoryCsv(base, 'producer,bottling,vintage,type,bottles\nChâteau Alpha,Grand Vin,2018,red,4', NOW);
    expect(r.errors).toEqual([]);
    expect(buildRows(r.data, NOW)[0]!.bottles).toBe(6);
    expect(base.purchases).toHaveLength(1); // input not mutated
  });

  it('explains what is missing instead of guessing', () => {
    expect(importInventoryCsv(emptyData(), '', NOW).errors[0]?.message).toMatch(/empty/i);
    const noKey = importInventoryCsv(emptyData(), 'foo,bar\n1,2', NOW);
    expect(noKey.errors[0]?.message).toMatch(/Producer/);
    expect(noKey.imported).toBe(0);
    const minimal = importInventoryCsv(emptyData(), 'Producer,Wine\nA,B\nC,D', NOW);
    expect(minimal.imported).toBe(2);
    expect(minimal.bottles).toBe(2);
    expect(minimal.warnings.join(' ')).toMatch(/Bottles/);
    expect(minimal.warnings.join(' ')).toMatch(/Colour/);
    expect(buildRows(minimal.data, NOW)[0]!.bottling.colour).toBeUndefined();
  });

  it('flags an unrecognised colour rather than silently relabelling it', () => {
    const r = importInventoryCsv(emptyData(), 'Producer,Wine,Colour,Bottles\nA,B,purple,1', NOW);
    expect(r.imported).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/colour/);
    expect(buildRows(r.data, NOW)[0]!.bottling.colour).toBeUndefined();
  });

  it('lists recognised and ignored columns', () => {
    const r = importInventoryCsv(emptyData(), 'Producer,Wine,Bottles,Favourite colour\nA,B,1,blue', NOW);
    expect(r.recognised).toEqual(expect.arrayContaining(['Producer → Producer', 'Wine → Bottling', 'Bottles → Bottles']));
    expect(r.ignored).toEqual(['Favourite colour']);
  });
});

describe('CSV export', () => {
  it('exports wines in stock with a header and re-imports to the same stock', () => {
    let data = buildSampleData(emptyData());
    const csv = exportInventoryCsv(data, ',', NOW);
    const table = parseCsv(csv);
    const rows = buildRows(data, NOW).filter((r) => r.bottles > 0);
    expect(table).toHaveLength(rows.length + 1);
    expect(table[0]![0]).toBe('producer');
    const re = importInventoryCsv(emptyData(), csv, NOW);
    expect(re.errors).toEqual([]);
    const key = (r: ReturnType<typeof buildRows>[number]) => `${r.producer.name}|${r.bottling.name}|${r.vintage.year}|${r.vintage.sizeMl}`;
    const want = new Map(rows.map((r) => [key(r), r.bottles]));
    const got = new Map(buildRows(re.data, NOW).filter((r) => r.bottles > 0).map((r) => [key(r), r.bottles]));
    expect(got).toEqual(want);
    // grapes and windows survive too
    const belle = buildRows(re.data, NOW).find((r) => r.producer.name === 'Château Belle-Rive' && r.vintage.year === 2015)!;
    expect(belle.bottling.grapes).toEqual([{ grape: 'Merlot', percent: 80 }, { grape: 'Cabernet Franc', percent: 20 }]);
    expect(belle.vintage).toMatchObject({ drinkFrom: 2023, drinkTo: 2035, peakFrom: 2026, peakTo: 2032 });
    data = emptyData();
    expect(parseCsv(exportInventoryCsv(data, ',', NOW))).toHaveLength(1); // header only
  });

  it('can use semicolons for European Excel', () => {
    const csv = exportInventoryCsv(buildSampleData(emptyData()), ';', NOW);
    expect(csv.split('\r\n')[0]).toContain('producer;group;bottling;vintage');
    expect(importInventoryCsv(emptyData(), csv, NOW).errors).toEqual([]);
  });
});
