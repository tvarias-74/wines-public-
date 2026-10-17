import type { Bottling, CellarData, Consumption, GrapeShare, Producer, Purchase, RemovalReason, Vintage, WineType } from './types';
import { SCHEMA_VERSION, STANDARD_BOTTLE_ML } from './types';
import { SAMPLE_PREFIX } from './actions';

/**
 * Demo wines so the app can be explored before any real data goes in.
 * Producers are fictional; regions, grapes and appellations are real, and the
 * prices, dates and windows are invented. Every id starts with `sample-` so the
 * demo data can be removed without touching anything the user added.
 */

type Buy = [date: string, qty: number, price?: number, merchant?: string];
type Drink = [date: string, qty: number, reason?: RemovalReason, notes?: string];

interface SampleVintage {
  year: number | null;
  sizeMl?: number;
  window?: [number, number];
  peak?: [number, number];
  location?: string;
  notes?: string;
  buys: Buy[];
  drank?: Drink[];
}

interface SampleBottling {
  name: string;
  type: WineType;
  country: string;
  region: string;
  appellation: string;
  grapes: GrapeShare[];
  vintages: SampleVintage[];
}

interface SampleProducer {
  name: string;
  bottlings: SampleBottling[];
}

const g = (grape: string, percent?: number): GrapeShare => (percent === undefined ? { grape } : { grape, percent });

const SAMPLE: SampleProducer[] = [
  {
    name: 'Château Belle-Rive',
    bottlings: [
      {
        name: 'Grand Cru Classé',
        type: 'red', country: 'France', region: 'Bordeaux', appellation: 'Saint-Émilion Grand Cru',
        grapes: [g('Merlot', 80), g('Cabernet Franc', 20)],
        vintages: [
          { year: 2015, window: [2023, 2035], peak: [2026, 2032], location: 'Rack A2', buys: [['2018-06-12', 6, 62, 'Maison Ardoise'], ['2020-11-03', 3, 74, 'Maison Ardoise']], drank: [['2025-12-24', 1, 'drunk', 'Christmas Eve. Silky and still youthful.']] },
          { year: 2016, window: [2025, 2040], peak: [2030, 2036], location: 'Rack A2', buys: [['2019-05-20', 12, 68, 'Maison Ardoise']], drank: [['2024-09-14', 1, 'drunk', 'Tight — needs another 3+ years.']] },
          { year: 2018, window: [2026, 2042], peak: [2032, 2038], location: 'Rack A3', buys: [['2021-04-09', 6, 59, 'Maison Ardoise']] },
        ],
      },
    ],
  },
  {
    name: 'Château Haut-Verger',
    bottlings: [
      {
        name: 'Grand Vin',
        type: 'red', country: 'France', region: 'Bordeaux', appellation: 'Pauillac',
        grapes: [g('Cabernet Sauvignon', 75), g('Merlot', 20), g('Cabernet Franc', 5)],
        vintages: [
          { year: 2010, window: [2020, 2030], peak: [2022, 2028], location: 'Rack A1', buys: [['2013-03-15', 6, 95, 'Cave Lafont (en primeur)']], drank: [['2022-02-10', 2, 'drunk', 'Classic Pauillac: cedar, graphite.']] },
          { year: 2016, window: [2028, 2050], peak: [2032, 2045], location: 'Rack A1', buys: [['2019-04-02', 6, 120, 'Cave Lafont (en primeur)']] },
        ],
      },
      {
        name: 'Second Vin',
        type: 'red', country: 'France', region: 'Bordeaux', appellation: 'Pauillac',
        grapes: [g('Merlot', 60), g('Cabernet Sauvignon', 40)],
        vintages: [
          { year: 2017, window: [2022, 2027], location: 'Rack A4', buys: [['2020-01-18', 12, 28, 'Cave Lafont']], drank: [['2023-05-06', 2, 'drunk'], ['2024-12-31', 2, 'drunk']] },
        ],
      },
    ],
  },
  {
    name: 'Domaine des Trois Collines',
    bottlings: [
      {
        name: 'Gevrey-Chambertin Vieilles Vignes',
        type: 'red', country: 'France', region: 'Burgundy', appellation: 'Gevrey-Chambertin',
        grapes: [g('Pinot Noir', 100)],
        vintages: [
          { year: 2017, window: [2022, 2028], peak: [2024, 2027], location: 'Rack B2', buys: [['2019-10-05', 6, 58, 'Direct from the estate']], drank: [['2023-06-17', 3, 'drunk', 'Wonderful with duck.']] },
          { year: 2019, window: [2024, 2032], peak: [2027, 2031], location: 'Rack B2', buys: [['2021-10-16', 6, 64, 'Direct from the estate']] },
          { year: 2020, window: [2026, 2034], peak: [2029, 2033], location: 'Rack B2', buys: [['2022-10-08', 6, 66, 'Direct from the estate']] },
        ],
      },
      {
        name: 'Meursault',
        type: 'white', country: 'France', region: 'Burgundy', appellation: 'Meursault',
        grapes: [g('Chardonnay', 100)],
        vintages: [
          { year: 2018, window: [2021, 2026], location: 'Rack B3', buys: [['2020-02-11', 6, 52, 'Direct from the estate']], drank: [['2024-04-20', 2, 'drunk']] },
          { year: 2020, window: [2024, 2030], peak: [2025, 2028], location: 'Rack B3', buys: [['2022-03-06', 6, 56, 'Direct from the estate']] },
        ],
      },
    ],
  },
  {
    name: 'Domaine du Vieux Chêne',
    bottlings: [
      {
        name: 'Châteauneuf-du-Pape Cuvée Tradition',
        type: 'red', country: 'France', region: 'Rhône', appellation: 'Châteauneuf-du-Pape',
        grapes: [g('Grenache', 70), g('Syrah', 15), g('Mourvèdre', 15)],
        vintages: [
          { year: 2015, window: [2019, 2030], location: 'Rack C1', buys: [['2018-09-22', 6, 38, 'Wine fair']], drank: [['2024-11-02', 1, 'drunk']] },
          { year: 2019, window: [2024, 2035], location: 'Rack C1', buys: [['2022-11-19', 12, 36, 'Wine fair']] },
        ],
      },
    ],
  },
  {
    name: 'Tenuta Montefiore',
    bottlings: [
      {
        name: 'Barolo Vigna Alta',
        type: 'red', country: 'Italy', region: 'Piedmont', appellation: 'Barolo DOCG',
        grapes: [g('Nebbiolo', 100)],
        vintages: [
          { year: 2016, window: [2024, 2046], peak: [2030, 2040], location: 'Rack C2', buys: [['2020-12-04', 6, 55, 'Enoteca Rossi']] },
          { year: 2017, window: [2025, 2040], location: 'Rack C2', buys: [['2021-12-10', 6, 52, 'Enoteca Rossi']] },
          { year: 2019, window: [2029, 2049], peak: [2034, 2044], location: 'Rack C2', buys: [['2023-12-01', 6, 58, 'Enoteca Rossi']] },
        ],
      },
    ],
  },
  {
    name: 'Tenuta San Giacomo',
    bottlings: [
      {
        name: 'Chianti Classico Riserva',
        type: 'red', country: 'Italy', region: 'Tuscany', appellation: 'Chianti Classico DOCG',
        grapes: [g('Sangiovese', 95), g('Canaiolo', 5)],
        vintages: [
          { year: 2018, window: [2022, 2030], location: 'Rack D1', buys: [['2021-05-14', 12, 24, 'Enoteca Rossi']], drank: [['2023-08-12', 2, 'drunk'], ['2025-06-21', 3, 'drunk', 'Summer barbecue.']] },
          { year: 2019, window: [2023, 2031], location: 'Rack D1', buys: [['2022-05-21', 6, 26, 'Enoteca Rossi']] },
        ],
      },
    ],
  },
  {
    name: 'Bodega Alto Cierzo',
    bottlings: [
      {
        name: 'Rioja Gran Reserva',
        type: 'red', country: 'Spain', region: 'Rioja', appellation: 'Rioja DOCa',
        grapes: [g('Tempranillo', 90), g('Graciano', 10)],
        vintages: [
          { year: 2010, window: [2018, 2026], location: 'Rack D2', buys: [['2017-02-25', 6, 32, 'Bodega shop']], drank: [['2024-03-30', 2, 'drunk']] },
          { year: 2012, window: [2022, 2032], location: 'Rack D2', buys: [['2019-03-09', 6, 30, 'Bodega shop']] },
        ],
      },
    ],
  },
  {
    name: 'Weingut Sonnenhang',
    bottlings: [
      {
        name: 'Riesling Spätlese',
        type: 'white', country: 'Germany', region: 'Mosel', appellation: 'Mosel',
        grapes: [g('Riesling', 100)],
        vintages: [
          { year: 2015, window: [2018, 2025], location: 'Fridge 1', buys: [['2017-08-26', 3, 21, 'Weinhaus Becker']] },
          { year: 2019, window: [2022, 2040], peak: [2026, 2034], location: 'Fridge 1', buys: [['2021-08-21', 6, 24, 'Weinhaus Becker']], drank: [['2025-05-10', 1, 'drunk']] },
          { year: 2022, location: 'Fridge 1', notes: 'Still to decide on a window.', buys: [['2024-08-24', 6, 22, 'Weinhaus Becker']] },
        ],
      },
    ],
  },
  {
    name: 'Maison Delacour',
    bottlings: [
      {
        name: 'Cuvée Prestige Brut',
        type: 'sparkling', country: 'France', region: 'Champagne', appellation: 'Champagne',
        grapes: [g('Chardonnay', 40), g('Pinot Noir', 40), g('Pinot Meunier', 20)],
        vintages: [
          { year: null, window: [2025, 2028], location: 'Fridge 2', buys: [['2025-12-06', 12, 39, 'Cave Lafont']], drank: [['2025-12-31', 3, 'drunk', 'New Year’s Eve.']] },
        ],
      },
      {
        name: 'Millésimé',
        type: 'sparkling', country: 'France', region: 'Champagne', appellation: 'Champagne',
        grapes: [g('Chardonnay', 55), g('Pinot Noir', 45)],
        vintages: [
          { year: 2012, window: [2020, 2032], peak: [2022, 2028], location: 'Rack D3', buys: [['2018-12-15', 6, 78, 'Cave Lafont']] },
        ],
      },
    ],
  },
  {
    name: 'Quinta da Serra Velha',
    bottlings: [
      {
        name: 'Vintage Port',
        type: 'fortified', country: 'Portugal', region: 'Douro', appellation: 'Porto',
        grapes: [g('Touriga Nacional', 40), g('Touriga Franca', 40), g('Tinta Roriz', 20)],
        vintages: [
          { year: 2016, window: [2036, 2070], peak: [2040, 2060], location: 'Rack E1', buys: [['2019-06-30', 6, 70, 'Auction house']] },
        ],
      },
    ],
  },
  {
    name: 'Kyma Estate',
    bottlings: [
      {
        name: 'Santorini',
        type: 'white', country: 'Greece', region: 'Santorini', appellation: 'Santorini PDO',
        grapes: [g('Assyrtiko', 100)],
        vintages: [
          { year: 2023, window: [2024, 2027], location: 'Fridge 2', buys: [['2024-07-07', 12, 19, 'Direct from the estate']], drank: [['2025-08-02', 2, 'drunk'], ['2026-06-14', 1, 'drunk']] },
          { year: 2024, window: [2025, 2029], location: 'Fridge 2', buys: [['2025-07-12', 6, 20, 'Direct from the estate']] },
        ],
      },
    ],
  },
  {
    name: 'Larkspur Hill',
    bottlings: [
      {
        name: 'Reserve Cabernet Sauvignon',
        type: 'red', country: 'USA', region: 'California', appellation: 'Napa Valley',
        grapes: [g('Cabernet Sauvignon', 92), g('Merlot', 8)],
        vintages: [
          { year: 2019, sizeMl: 1500, window: [2026, 2040], peak: [2030, 2036], location: 'Rack E2', notes: 'Magnums, for a big dinner.', buys: [['2023-11-25', 2, 190, 'Auction house']] },
          { year: 2019, window: [2026, 2040], peak: [2030, 2036], location: 'Rack E2', buys: [['2024-12-24', 1, undefined, 'Gift']] },
        ],
      },
    ],
  },
];

export function buildSampleData(base: CellarData): CellarData {
  let n = 0;
  const id = (kind: string) => `${SAMPLE_PREFIX}${kind}-${++n}`;
  const producers: Producer[] = [];
  const bottlings: Bottling[] = [];
  const vintages: Vintage[] = [];
  const purchases: Purchase[] = [];
  const consumptions: Consumption[] = [];

  for (const p of SAMPLE) {
    const producer: Producer = { id: id('p'), name: p.name };
    producers.push(producer);
    for (const b of p.bottlings) {
      const bottling: Bottling = {
        id: id('b'),
        producerId: producer.id,
        name: b.name,
        type: b.type,
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
          ...(v.location ? { location: v.location } : {}),
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
        for (const [date, quantity, reason, notes] of v.drank ?? []) {
          consumptions.push({ id: id('co'), vintageId: vintage.id, date, quantity, reason: reason ?? 'drunk', ...(notes ? { notes } : {}) });
        }
      }
    }
  }

  return {
    ...base,
    schema: SCHEMA_VERSION,
    producers: [...base.producers, ...producers],
    bottlings: [...base.bottlings, ...bottlings],
    vintages: [...base.vintages, ...vintages],
    purchases: [...base.purchases, ...purchases],
    consumptions: [...base.consumptions, ...consumptions],
  };
}
