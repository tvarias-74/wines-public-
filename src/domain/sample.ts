import type { Bottling, BoxMaterial, CellarData, Colour, Consumption, GrapeShare, Group, Location, Producer, Purchase, RemovalReason, Review, Vintage, WineStyle } from './types';
import { SCHEMA_VERSION, STANDARD_BOTTLE_ML } from './types';
import { SAMPLE_PREFIX, placeBottles, suggestPlacement } from './actions';

/**
 * Demo wines so the app can be explored before any real data goes in.
 * Producers, owners and critics are fictional; regions, grapes and appellations are real, and the
 * prices, dates, windows and scores are invented. Every id starts with `sample-` so the demo data
 * can be removed without touching anything the user added.
 */

type Buy = [date: string, qty: number, price?: number, merchant?: string];
type Drink = [date: string, qty: number, reason?: RemovalReason, notes?: string, rating?: number, impressions?: string[]];

interface SampleVintage {
  year: number | null;
  sizeMl?: number;
  window?: [number, number];
  peak?: [number, number];
  notes?: string;
  buys: Buy[];
  drank?: Drink[];
  /** Bottles kept in a floor box instead of a division: [box name, how many]. */
  box?: [string, number];
  review?: { score: number; text: string };
}

interface SampleBottling {
  name: string;
  colour: Colour;
  sparkling?: boolean;
  style?: WineStyle;
  country: string;
  region: string;
  appellation: string;
  grapes: GrapeShare[];
  vintages: SampleVintage[];
}

interface SampleProducer {
  name: string;
  /** The family or company that owns it. */
  group?: string;
  bottlings: SampleBottling[];
}

const g = (grape: string, percent?: number): GrapeShare => (percent === undefined ? { grape } : { grape, percent });

const SAMPLE: SampleProducer[] = [
  {
    name: 'Château Belle-Rive',
    bottlings: [
      {
        name: 'Grand Cru Classé',
        colour: 'red', country: 'France', region: 'Bordeaux', appellation: 'Saint-Émilion Grand Cru',
        grapes: [g('Merlot', 80), g('Cabernet Franc', 20)],
        vintages: [
          { year: 2015, window: [2023, 2035], peak: [2026, 2032], buys: [['2018-06-12', 6, 62, 'Maison Ardoise'], ['2020-11-03', 3, 74, 'Maison Ardoise']], drank: [['2025-12-24', 1, 'drunk', 'Christmas Eve. Silky and still youthful.', 18, ['blackcurrant', 'cedar', 'silky', 'drinking-well']]] },
          { year: 2016, window: [2025, 2040], peak: [2030, 2036], buys: [['2019-05-20', 12, 68, 'Maison Ardoise']], drank: [['2024-09-14', 1, 'drunk', 'Tight — needs another 3+ years.', 16, ['plum', 'tannin-firm', 'too-young']]], review: { score: 94, text: 'Dense and polished, with a long, savoury finish.' } },
          { year: 2018, window: [2026, 2042], peak: [2032, 2038], buys: [['2021-04-09', 6, 59, 'Maison Ardoise']] },
        ],
      },
    ],
  },
  {
    name: 'Château Haut-Verger',
    group: 'Famille Delacour-Verger',
    bottlings: [
      {
        name: 'Grand Vin',
        colour: 'red', country: 'France', region: 'Bordeaux', appellation: 'Pauillac',
        grapes: [g('Cabernet Sauvignon', 75), g('Merlot', 20), g('Cabernet Franc', 5)],
        vintages: [
          { year: 2010, window: [2020, 2030], peak: [2022, 2028], buys: [['2013-03-15', 6, 95, 'Cave Lafont (en primeur)']], drank: [['2022-02-10', 2, 'drunk', 'Classic Pauillac: cedar, graphite.', 17.5, ['cedar', 'graphite', 'blackcurrant', 'tannin-firm', 'finish-long']]] },
          { year: 2016, window: [2028, 2050], peak: [2032, 2045], buys: [['2019-04-02', 6, 120, 'Cave Lafont (en primeur)']] },
        ],
      },
      {
        name: 'Second Vin',
        colour: 'red', country: 'France', region: 'Bordeaux', appellation: 'Pauillac',
        grapes: [g('Merlot', 60), g('Cabernet Sauvignon', 40)],
        vintages: [
          { year: 2017, window: [2022, 2027], buys: [['2020-01-18', 12, 28, 'Cave Lafont']], drank: [['2023-05-06', 2, 'drunk', undefined, 15, ['red-berries', 'balanced']], ['2024-12-31', 2, 'drunk']] },
        ],
      },
    ],
  },
  {
    name: 'Domaine des Trois Collines',
    bottlings: [
      {
        name: 'Gevrey-Chambertin Vieilles Vignes',
        colour: 'red', country: 'France', region: 'Burgundy', appellation: 'Gevrey-Chambertin',
        grapes: [g('Pinot Noir', 100)],
        vintages: [
          { year: 2017, window: [2022, 2028], peak: [2024, 2027], buys: [['2019-10-05', 6, 58, 'Direct from the estate']], drank: [['2023-06-17', 3, 'drunk', 'Wonderful with duck.', 18.5, ['cherry', 'violet', 'forest-floor', 'silky', 'at-peak', 'would-buy-again']]] },
          { year: 2019, window: [2024, 2032], peak: [2027, 2031], buys: [['2021-10-16', 6, 64, 'Direct from the estate']] },
          { year: 2020, window: [2026, 2034], peak: [2029, 2033], buys: [['2022-10-08', 6, 66, 'Direct from the estate']] },
        ],
      },
      {
        name: 'Meursault',
        colour: 'white', country: 'France', region: 'Burgundy', appellation: 'Meursault',
        grapes: [g('Chardonnay', 100)],
        vintages: [
          { year: 2018, window: [2021, 2026], buys: [['2020-02-11', 6, 52, 'Direct from the estate']], drank: [['2024-04-20', 2, 'drunk', undefined, 17, ['butter', 'nuts', 'creamy']]] },
          { year: 2020, window: [2024, 2030], peak: [2025, 2028], buys: [['2022-03-06', 6, 56, 'Direct from the estate'], ['2026-03-14', 3, 61, 'Direct from the estate']] },
        ],
      },
    ],
  },
  {
    name: 'Domaine du Vieux Chêne',
    bottlings: [
      {
        name: 'Châteauneuf-du-Pape Cuvée Tradition',
        colour: 'red', country: 'France', region: 'Rhône', appellation: 'Châteauneuf-du-Pape',
        grapes: [g('Grenache', 70), g('Syrah', 15), g('Mourvèdre', 15)],
        vintages: [
          { year: 2015, window: [2019, 2030], buys: [['2018-09-22', 6, 38, 'Wine fair']], drank: [['2024-11-02', 1, 'drunk', undefined, 16.5, ['jam', 'black-pepper', 'hot']]] },
          { year: 2019, window: [2024, 2035], buys: [['2022-11-19', 12, 36, 'Wine fair']] },
        ],
      },
    ],
  },
  {
    name: 'Tenuta Montefiore',
    group: 'Gruppo Riva',
    bottlings: [
      {
        name: 'Barolo Vigna Alta',
        colour: 'red', country: 'Italy', region: 'Piedmont', appellation: 'Barolo DOCG',
        grapes: [g('Nebbiolo', 100)],
        vintages: [
          { year: 2016, window: [2024, 2046], peak: [2030, 2040], buys: [['2020-12-04', 6, 55, 'Enoteca Rossi']], review: { score: 95, text: 'Rose petals and tar; fine tannins that will soften with time.' } },
          { year: 2017, window: [2025, 2040], buys: [['2021-12-10', 6, 52, 'Enoteca Rossi']] },
          { year: 2019, window: [2029, 2049], peak: [2034, 2044], buys: [['2023-12-01', 6, 58, 'Enoteca Rossi']] },
        ],
      },
    ],
  },
  {
    name: 'Tenuta San Giacomo',
    group: 'Gruppo Riva',
    bottlings: [
      {
        name: 'Chianti Classico Riserva',
        colour: 'red', country: 'Italy', region: 'Tuscany', appellation: 'Chianti Classico DOCG',
        grapes: [g('Sangiovese', 95), g('Canaiolo', 5)],
        vintages: [
          { year: 2018, window: [2022, 2030], buys: [['2021-05-14', 12, 24, 'Enoteca Rossi']], drank: [['2023-08-12', 2, 'drunk', undefined, 16, ['cherry', 'acidity-fresh']], ['2025-06-21', 3, 'drunk', 'Summer barbecue.', 15.5, ['red-berries', 'herbs', 'great-value']]] },
          { year: 2019, window: [2023, 2031], buys: [['2022-05-21', 6, 26, 'Enoteca Rossi']] },
        ],
      },
    ],
  },
  {
    name: 'Bodega Alto Cierzo',
    bottlings: [
      {
        name: 'Rioja Gran Reserva',
        colour: 'red', country: 'Spain', region: 'Rioja', appellation: 'Rioja DOCa',
        grapes: [g('Tempranillo', 90), g('Graciano', 10)],
        vintages: [
          { year: 2010, window: [2018, 2026], buys: [['2017-02-25', 6, 32, 'Bodega shop']], drank: [['2024-03-30', 2, 'drunk', undefined, 17, ['leather', 'vanilla', 'tobacco', 'silky']]] },
          { year: 2012, window: [2022, 2032], buys: [['2019-03-09', 6, 30, 'Bodega shop']] },
        ],
      },
    ],
  },
  {
    name: 'Weingut Sonnenhang',
    bottlings: [
      {
        name: 'Riesling Spätlese',
        colour: 'white', country: 'Germany', region: 'Mosel', appellation: 'Mosel',
        grapes: [g('Riesling', 100)],
        vintages: [
          { year: 2015, window: [2018, 2025], buys: [['2017-08-26', 3, 21, 'Weinhaus Becker']] },
          { year: 2019, window: [2022, 2040], peak: [2026, 2034], buys: [['2021-08-21', 6, 24, 'Weinhaus Becker']], drank: [['2025-05-10', 1, 'drunk', undefined, 17.5, ['citrus', 'petrol', 'off-dry', 'acidity-high']]] },
          { year: 2022, notes: 'Still to decide on a window.', buys: [['2024-08-24', 6, 22, 'Weinhaus Becker']] },
        ],
      },
    ],
  },
  {
    name: 'Maison Delacour',
    group: 'Famille Delacour-Verger',
    bottlings: [
      {
        name: 'Cuvée Prestige Brut',
        colour: 'white', sparkling: true, country: 'France', region: 'Champagne', appellation: 'Champagne',
        grapes: [g('Chardonnay', 40), g('Pinot Noir', 40), g('Pinot Meunier', 20)],
        vintages: [
          { year: null, window: [2025, 2028], buys: [['2025-12-06', 12, 39, 'Cave Lafont']], drank: [['2025-12-31', 3, 'drunk', 'New Year’s Eve.', 16, ['green-apple', 'brioche', 'balanced']]] },
        ],
      },
      {
        name: 'Rosé Brut',
        colour: 'rose', sparkling: true, country: 'France', region: 'Champagne', appellation: 'Champagne',
        grapes: [g('Pinot Noir', 60), g('Chardonnay', 40)],
        vintages: [{ year: null, window: [2025, 2029], buys: [['2025-12-06', 6, 45, 'Cave Lafont']] }],
      },
      {
        name: 'Millésimé',
        colour: 'white', sparkling: true, country: 'France', region: 'Champagne', appellation: 'Champagne',
        grapes: [g('Chardonnay', 55), g('Pinot Noir', 45)],
        vintages: [{ year: 2012, window: [2020, 2032], peak: [2022, 2028], buys: [['2018-12-15', 6, 78, 'Cave Lafont']] }],
      },
    ],
  },
  {
    name: 'Cantina Ramato',
    bottlings: [
      {
        name: 'Pinot Grigio Ramato',
        colour: 'orange', country: 'Italy', region: 'Friuli-Venezia Giulia', appellation: 'Venezia Giulia IGT',
        grapes: [g('Pinot Gris', 100)],
        vintages: [{ year: 2022, window: [2024, 2028], notes: 'Skin-contact: serve lightly chilled.', buys: [['2024-05-18', 6, 22, 'Wine fair']], drank: [['2025-07-19', 1, 'drunk', undefined, 16, ['stone-fruit', 'tea', 'tannin-grippy']]] }],
      },
    ],
  },
  {
    name: 'Quinta da Serra Velha',
    bottlings: [
      {
        name: 'Vintage Port',
        colour: 'red', style: 'fortified', country: 'Portugal', region: 'Douro', appellation: 'Porto',
        grapes: [g('Touriga Nacional', 40), g('Touriga Franca', 40), g('Tinta Roriz', 20)],
        vintages: [{ year: 2016, window: [2036, 2070], peak: [2040, 2060], buys: [['2019-06-30', 6, 70, 'Auction house']] }],
      },
    ],
  },
  {
    name: 'Kyma Estate',
    group: 'Meridian Wine Partners',
    bottlings: [
      {
        name: 'Santorini',
        colour: 'white', country: 'Greece', region: 'Santorini', appellation: 'Santorini PDO',
        grapes: [g('Assyrtiko', 100)],
        vintages: [
          { year: 2023, window: [2024, 2027], buys: [['2024-07-07', 12, 19, 'Direct from the estate']], drank: [['2025-08-02', 2, 'drunk', undefined, 16.5, ['citrus', 'saline', 'acidity-high']], ['2026-06-14', 1, 'drunk', undefined, 17, ['saline', 'wet-stone', 'finish-long']]] },
          { year: 2024, window: [2025, 2029], buys: [['2025-07-12', 6, 20, 'Direct from the estate'], ['2026-05-30', 6, 21, 'Direct from the estate']], box: ['Carton — Kyma Santorini', 6] },
        ],
      },
    ],
  },
  {
    name: 'Larkspur Hill',
    group: 'Meridian Wine Partners',
    bottlings: [
      {
        name: 'Reserve Cabernet Sauvignon',
        colour: 'red', country: 'USA', region: 'California', appellation: 'Napa Valley',
        grapes: [g('Cabernet Sauvignon', 92), g('Merlot', 8)],
        vintages: [
          { year: 2019, sizeMl: 1500, window: [2026, 2040], peak: [2030, 2036], notes: 'Magnums, for a big dinner.', buys: [['2023-11-25', 2, 190, 'Auction house']], box: ['Wooden box — Larkspur magnums', 2] },
          { year: 2019, window: [2026, 2040], peak: [2030, 2036], buys: [['2024-12-24', 1, undefined, 'Gift']] },
        ],
      },
    ],
  },
];

/** A made-up cellar: 50 divisions of 15 bottles, and two boxes on the floor. */
const BOXES: { name: string; material: BoxMaterial; capacity: number }[] = [
  { name: 'Wooden box — Larkspur magnums', material: 'wooden', capacity: 3 },
  { name: 'Carton — Kyma Santorini', material: 'carton', capacity: 12 },
];

export function buildSampleData(base: CellarData): CellarData {
  let n = 0;
  const id = (kind: string) => `${SAMPLE_PREFIX}${kind}-${++n}`;
  const groups: Group[] = [];
  const producers: Producer[] = [];
  const bottlings: Bottling[] = [];
  const vintages: Vintage[] = [];
  const purchases: Purchase[] = [];
  const consumptions: Consumption[] = [];
  const reviews: Review[] = [];
  const boxPlans: { vintageId: string; box: string; qty: number }[] = [];

  for (const p of SAMPLE) {
    let groupId: string | undefined;
    if (p.group) {
      let grp = groups.find((x) => x.name === p.group);
      if (!grp) {
        grp = { id: id('g'), name: p.group };
        groups.push(grp);
      }
      groupId = grp.id;
    }
    const producer: Producer = { id: id('p'), name: p.name, ...(groupId ? { groupId } : {}) };
    producers.push(producer);
    for (const b of p.bottlings) {
      const bottling: Bottling = {
        id: id('b'),
        producerId: producer.id,
        name: b.name,
        colour: b.colour,
        sparkling: b.sparkling ?? false,
        ...(b.style ? { style: b.style } : {}),
        country: b.country,
        region: b.region,
        appellation: b.appellation,
        grapes: b.grapes,
      };
      bottlings.push(bottling);
      for (const v of b.vintages) {
        const vintage: Vintage = {
          id: id('v'),
          bottlingId: bottling.id,
          year: v.year,
          sizeMl: v.sizeMl ?? STANDARD_BOTTLE_ML,
          ...(v.window ? { drinkFrom: v.window[0], drinkTo: v.window[1], windowSource: 'manual' as const } : {}),
          ...(v.peak ? { peakFrom: v.peak[0], peakTo: v.peak[1] } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
        };
        vintages.push(vintage);
        for (const [date, quantity, unitPrice, merchant] of v.buys) {
          purchases.push({
            id: id('pu'),
            vintageId: vintage.id,
            date,
            quantity,
            ...(unitPrice !== undefined ? { unitPrice } : {}),
            ...(merchant ? { merchant } : {}),
          });
        }
        for (const [date, quantity, reason, notes, rating, impressions] of v.drank ?? []) {
          consumptions.push({
            id: id('co'),
            vintageId: vintage.id,
            date,
            quantity,
            reason: reason ?? 'drunk',
            ...(notes ? { notes } : {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(impressions ? { impressions } : {}),
          });
        }
        if (v.review) {
          reviews.push({ id: id('rv'), vintageId: vintage.id, source: 'other', sourceName: 'Sample Wine Guide', score: v.review.score, scale: 100, text: v.review.text, date: '2024' });
        }
        if (v.box) boxPlans.push({ vintageId: vintage.id, box: v.box[0], qty: v.box[1] });
      }
    }
  }

  const locations: Location[] = [];
  for (let d = 1; d <= 50; d++) locations.push({ id: `${SAMPLE_PREFIX}loc-${d}`, name: `Division ${d}`, kind: 'division', capacity: 15 });
  BOXES.forEach((b, i) => locations.push({ id: `${SAMPLE_PREFIX}box-${i + 1}`, name: b.name, kind: 'box', material: b.material, capacity: b.capacity }));

  let data: CellarData = {
    ...base,
    schema: SCHEMA_VERSION,
    groups: [...base.groups, ...groups],
    producers: [...base.producers, ...producers],
    bottlings: [...base.bottlings, ...bottlings],
    vintages: [...base.vintages, ...vintages],
    purchases: [...base.purchases, ...purchases],
    consumptions: [...base.consumptions, ...consumptions],
    locations: [...base.locations, ...locations],
    placements: base.placements,
    reviews: [...base.reviews, ...reviews],
  };

  // Floor boxes first (explicit), then everything else into divisions, keeping each wine together.
  for (const plan of boxPlans) {
    const box = data.locations.find((l) => l.name === plan.box);
    const stock = stockFor(data, plan.vintageId);
    if (!box || stock < 1) continue;
    const placed = placeBottles(data, plan.vintageId, box.id, Math.min(plan.qty, stock));
    if (placed.ok) data = placed.data;
  }
  for (const v of vintages) {
    const unplaced = stockFor(data, v.id) - data.placements.filter((p) => p.vintageId === v.id).reduce((s, p) => s + p.quantity, 0);
    if (unplaced < 1) continue;
    for (const step of suggestPlacement(data, v.id, unplaced).plan) {
      const placed = placeBottles(data, v.id, step.locationId, step.quantity);
      if (placed.ok) data = placed.data;
    }
  }
  return data;
}

function stockFor(data: CellarData, vintageId: string): number {
  let n = 0;
  for (const p of data.purchases) if (p.vintageId === vintageId) n += p.quantity;
  for (const c of data.consumptions) if (c.vintageId === vintageId) n -= c.quantity;
  return Math.max(0, n);
}
