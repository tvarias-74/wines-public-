/** Minimal RFC 4180 CSV reader/writer that also copes with `;`/tab-delimited European exports. */

const BOM = '﻿';

function detectDelimiter(text: string): string {
  // Count candidate delimiters on the first non-empty line, outside quotes.
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\n') {
        if (Object.values(counts).some((n) => n > 0)) break;
      } else if (ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
    }
  }
  let best = ',';
  for (const d of [',', ';', '\t']) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d;
  return best;
}

export interface CsvRow {
  cells: string[];
  /** The line of the file the row starts on, counting blank lines and lines inside quoted cells. */
  line: number;
}

export function parseCsv(input: string): string[][] {
  return parseCsvRows(input).map((r) => r.cells);
}

export function parseCsvRows(input: string): CsvRow[] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((c) => c.trim() !== '')) rows.push({ cells: row, line: rowLine });
    row = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '\n') line++;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
        line++;
      } else if (ch === '\r') line++;
      endRow();
      rowLine = line;
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

type Cell = string | number | null | undefined;

function escapeCell(value: Cell, delimiter: string): string {
  if (value === null || value === undefined) return '';
  // With ";" the file is for a European-language spreadsheet, which reads 12,5 as a number and 12.5 as text or a date.
  let s = typeof value === 'number' && delimiter === ';' ? String(value).replace('.', ',') : String(value);
  // A text cell that starts like a formula would be executed by Excel/Sheets.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM first, so Excel reads accents and Greek correctly. */
export function toCsv(rows: Cell[][], delimiter = ','): string {
  return BOM + rows.map((r) => r.map((c) => escapeCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
