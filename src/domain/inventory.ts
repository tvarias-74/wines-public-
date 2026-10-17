import type { Bottling, CellarData, Consumption, Producer, Purchase, Vintage, WineType } from './types';
import { WINE_TYPE_LABEL } from './types';
import { compareText, formatYear, normalizeText, sizeBadge, yearOfDate } from './text';
import { STATUS_ORDER, windowOf, windowStatus, type WindowStatus } from './window';

/** One vintage with everything derived from the purchase/consumption ledger. */
export interface WineRow {
  vintage: Vintage;
  bottling: Bottling;
  producer: Producer;
  /** Bottles currently in the cellar. */
  bottles: number;
  purchased: number;
  consumed: number;
  /** Money spent on purchases whose price is known. */
  spent: number;
  /** Bottles bought at a known price. */
  pricedBottles: number;
  /** Average price paid per bottle, or null when no price was ever recorded. */
  avgPrice: number | null;
  firstPurchase: string | null;
  lastPurchase: string | null;
  /** Status as of now. Only meaningful while `bottles > 0`. */
  status: WindowStatus;
}

export function buildRows(data: CellarData, now: Date = new Date()): WineRow[] {
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const year = now.getFullYear();

  interface Acc {
    purchased: number;
    consumed: number;
    spent: number;
    priced: number;
    first: string | null;
    last: string | null;
  }
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { purchased: 0, consumed: 0, spent: 0, priced: 0, first: null, last: null };
      acc.set(id, a);
    }
    return a;
  };

  for (const p of data.purchases) {
    const a = get(p.vintageId);
    a.purchased += p.quantity;
    if (p.unitPrice !== undefined) {
      a.spent += p.unitPrice * p.quantity;
      a.priced += p.quantity;
    }
    if (p.date) {
      if (a.first === null || p.date < a.first) a.first = p.date;
      if (a.last === null || p.date > a.last) a.last = p.date;
    }
  }
  for (const c of data.consumptions) get(c.vintageId).consumed += c.quantity;

  const rows: WineRow[] = [];
  for (const vintage of data.vintages) {
    const bottling = bottlings.get(vintage.bottlingId);
    const producer = bottling ? producers.get(bottling.producerId) : undefined;
    if (!bottling || !producer) continue;
    const a = acc.get(vintage.id) ?? { purchased: 0, consumed: 0, spent: 0, priced: 0, first: null, last: null };
    rows.push({
      vintage,
      bottling,
      producer,
      bottles: Math.max(0, a.purchased - a.consumed),
      purchased: a.purchased,
      consumed: a.consumed,
      spent: a.spent,
      pricedBottles: a.priced,
      avgPrice: a.priced > 0 ? a.spent / a.priced : null,
      firstPurchase: a.first,
      lastPurchase: a.last,
      status: windowStatus(windowOf(vintage), year, data.settings.drinkSoonYears),
    });
  }
  return rows;
}

/** "Château X Grand Vin 2018", with the bottle size when it isn't a standard 75 cl ("… 2018 (Magnum)"). */
export function wineTitle(row: Pick<WineRow, 'producer' | 'bottling' | 'vintage'>): string {
  const size = sizeBadge(row.vintage.sizeMl);
  return `${row.producer.name} ${row.bottling.name} ${formatYear(row.vintage.year)}${size ? ` (${size})` : ''}`;
}

/** Newest vintage first, non-vintage last. */
function compareVintages(a: WineRow, b: WineRow): number {
  const ay = a.vintage.year;
  const by = b.vintage.year;
  if (ay === by) return a.vintage.sizeMl - b.vintage.sizeMl;
  if (ay === null) return 1;
  if (by === null) return -1;
  return by - ay;
}

export interface BottlingGroup {
  bottling: Bottling;
  rows: WineRow[];
  bottles: number;
}
export interface ProducerGroup {
  producer: Producer;
  bottlings: BottlingGroup[];
  bottles: number;
  vintages: number;
}

/** Producer → bottling → vintage tree, with bottle counts rolled up at each level. */
export function groupByProducer(rows: WineRow[]): ProducerGroup[] {
  const producers = new Map<string, { producer: Producer; bottlings: Map<string, BottlingGroup> }>();
  for (const row of rows) {
    let p = producers.get(row.producer.id);
    if (!p) {
      p = { producer: row.producer, bottlings: new Map() };
      producers.set(row.producer.id, p);
    }
    let b = p.bottlings.get(row.bottling.id);
    if (!b) {
      b = { bottling: row.bottling, rows: [], bottles: 0 };
      p.bottlings.set(row.bottling.id, b);
    }
    b.rows.push(row);
    b.bottles += row.bottles;
  }
  return [...producers.values()]
    .map(({ producer, bottlings }) => {
      const list = [...bottlings.values()].sort((a, b) => compareText(a.bottling.name, b.bottling.name));
      list.forEach((g) => g.rows.sort(compareVintages));
      return {
        producer,
        bottlings: list,
        bottles: list.reduce((n, g) => n + g.bottles, 0),
        vintages: list.reduce((n, g) => n + g.rows.length, 0),
      };
    })
    .sort((a, b) => compareText(a.producer.name, b.producer.name));
}

export interface RowFilter {
  query?: string;
  type?: WineType | '';
  status?: WindowStatus | '';
  country?: string;
  /** Keep wines with no bottles left (the drinking history). */
  includeFinished?: boolean;
}

// Rows are rebuilt whenever the data changes, so a per-row cache can never go stale.
const haystacks = new WeakMap<WineRow, string>();

function haystack(row: WineRow): string {
  let h = haystacks.get(row);
  if (h === undefined) {
    const { bottling: b, vintage: v, producer: p } = row;
    h = normalizeText(
      [p.name, b.name, formatYear(v.year), b.region, b.country, b.appellation, v.location, WINE_TYPE_LABEL[b.type], ...b.grapes.map((g) => g.grape)]
        .filter(Boolean)
        .join(' '),
    );
    haystacks.set(row, h);
  }
  return h;
}

export function filterRows(rows: WineRow[], f: RowFilter): WineRow[] {
  const tokens = f.query ? normalizeText(f.query).split(' ').filter(Boolean) : [];
  return rows.filter((row) => {
    if (!f.includeFinished && row.bottles === 0) return false;
    if (f.type && row.bottling.type !== f.type) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.country !== undefined && f.country !== '' && (row.bottling.country ?? '') !== (f.country === NOT_SET ? '' : f.country)) return false;
    if (tokens.length) {
      const h = haystack(row);
      if (!tokens.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}

/** Sentinel used in the country filter for wines with no country recorded. */
export const NOT_SET = '__not_set__';

export interface Count {
  key: string;
  label: string;
  bottles: number;
}

function countBy(rows: WineRow[], keyOf: (r: WineRow) => string, labelOf: (key: string) => string): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.bottles === 0) continue;
    const k = keyOf(r);
    m.set(k, (m.get(k) ?? 0) + r.bottles);
  }
  return [...m.entries()]
    .map(([key, bottles]) => ({ key, label: labelOf(key), bottles }))
    .sort((a, b) => b.bottles - a.bottles || compareText(a.label, b.label));
}

export interface CellarStats {
  bottles: number;
  wines: number;
  producers: number;
  /** Cost of the bottles in stock, valued at the average price paid for each wine. */
  costOfStock: number;
  /** Bottles in stock that the cost figure covers (price known). */
  pricedBottles: number;
  unpricedBottles: number;
  byStatus: Record<WindowStatus, number>;
  byType: Count[];
  byCountry: Count[];
}

export function computeStats(rows: WineRow[]): CellarStats {
  const stock = rows.filter((r) => r.bottles > 0);
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WindowStatus, number>;
  let bottles = 0;
  let cost = 0;
  let priced = 0;
  for (const r of stock) {
    bottles += r.bottles;
    byStatus[r.status] += r.bottles;
    if (r.avgPrice !== null) {
      cost += r.avgPrice * r.bottles;
      priced += r.bottles;
    }
  }
  return {
    bottles,
    wines: stock.length,
    producers: new Set(stock.map((r) => r.producer.id)).size,
    costOfStock: cost,
    pricedBottles: priced,
    unpricedBottles: bottles - priced,
    byStatus,
    byType: countBy(stock, (r) => r.bottling.type, (k) => WINE_TYPE_LABEL[k as WineType]),
    byCountry: countBy(stock, (r) => r.bottling.country ?? NOT_SET, (k) => (k === NOT_SET ? 'Not set' : k)),
  };
}

export interface ForecastYear {
  year: number;
  counts: Record<WindowStatus, number>;
}

/**
 * How the cellar matures if nothing is opened: per calendar year, how many
 * bottles are still waiting, ready, at peak, closing soon or past their window.
 */
export function forecastByYear(rows: WineRow[], startYear: number, years: number, soonYears: number): ForecastYear[] {
  const out: ForecastYear[] = [];
  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WindowStatus, number>;
    for (const r of rows) {
      if (r.bottles === 0) continue;
      counts[windowStatus(windowOf(r.vintage), year, soonYears)] += r.bottles;
    }
    out.push({ year, counts });
  }
  return out;
}

export interface PurchaseEntry {
  purchase: Purchase;
  vintage: Vintage;
  bottling: Bottling;
  producer: Producer;
}

/** Every purchase joined to its wine, newest first; undated purchases last. */
export function purchaseEntries(data: CellarData): PurchaseEntry[] {
  const vintages = new Map(data.vintages.map((v) => [v.id, v]));
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const out: PurchaseEntry[] = [];
  for (const purchase of data.purchases) {
    const vintage = vintages.get(purchase.vintageId);
    const bottling = vintage ? bottlings.get(vintage.bottlingId) : undefined;
    const producer = bottling ? producers.get(bottling.producerId) : undefined;
    if (vintage && bottling && producer) out.push({ purchase, vintage, bottling, producer });
  }
  return out.sort((a, b) => {
    const ad = a.purchase.date ?? '';
    const bd = b.purchase.date ?? '';
    if (ad === bd) return compareText(a.producer.name, b.producer.name);
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });
}

export interface YearBucket {
  /** `null` groups purchases with no date. */
  year: number | null;
  bottles: number;
  spent: number;
  pricedBottles: number;
  purchases: number;
}

export function purchasesByYear(entries: PurchaseEntry[]): YearBucket[] {
  const m = new Map<number | null, YearBucket>();
  for (const { purchase: p } of entries) {
    const year = p.date ? yearOfDate(p.date) : null;
    let b = m.get(year);
    if (!b) {
      b = { year, bottles: 0, spent: 0, pricedBottles: 0, purchases: 0 };
      m.set(year, b);
    }
    b.bottles += p.quantity;
    b.purchases += 1;
    if (p.unitPrice !== undefined) {
      b.spent += p.unitPrice * p.quantity;
      b.pricedBottles += p.quantity;
    }
  }
  return [...m.values()].sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : b.year - a.year));
}

export function stockOf(data: CellarData, vintageId: string): number {
  let n = 0;
  for (const p of data.purchases) if (p.vintageId === vintageId) n += p.quantity;
  for (const c of data.consumptions) if (c.vintageId === vintageId) n -= c.quantity;
  return Math.max(0, n);
}

export function purchasedOf(purchases: Purchase[], vintageId: string): number {
  return purchases.filter((p) => p.vintageId === vintageId).reduce((n, p) => n + p.quantity, 0);
}

export function consumedOf(consumptions: Consumption[], vintageId: string): number {
  return consumptions.filter((c) => c.vintageId === vintageId).reduce((n, c) => n + c.quantity, 0);
}
