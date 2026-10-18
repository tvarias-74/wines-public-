import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes, embedded delimiters and newlines', () => {
    expect(parseCsv('a,b,c\n"x,1","he said ""hi""","line1\nline2"\n')).toEqual([
      ['a', 'b', 'c'],
      ['x,1', 'he said "hi"', 'line1\nline2'],
    ]);
  });
  it('handles CRLF, a BOM, a missing final newline and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('detects semicolon and tab delimiters (European Excel)', () => {
    expect(parseCsv('a;b;c\n1,5;2;3')).toEqual([['a', 'b', 'c'], ['1,5', '2', '3']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('keeps empty cells', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes where needed and writes a BOM', () => {
    const out = toCsv([['a', 'b,c', 'd"e'], [1, null, undefined]]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.slice(1)).toBe('a,"b,c","d""e"\r\n1,,\r\n');
  });
  it('neutralises spreadsheet formulas in text but not in numbers', () => {
    expect(toCsv([['=SUM(A1)', '+1', '@x', -5]]).slice(1)).toBe("'=SUM(A1),'+1,'@x,-5\r\n");
  });
  it('round-trips through parseCsv, including accents, Greek and a custom delimiter', () => {
    const rows = [['Producer', 'Notes'], ['Château Léoville', 'multi\nline; with, punctuation'], ['Κτήμα Κύρου', '"quoted"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv(toCsv(rows, ';'))).toEqual(rows);
  });
});
