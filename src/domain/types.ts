/**
 * The cellar is stored as one document. A wine is described on three levels,
 * mirroring how collectors talk about their bottles:
 *
 *   Producer  →  Bottling (the label / cuvée)  →  Vintage (a year, in a bottle size)
 *
 * Grape varieties belong to the bottling, the drinking window to the vintage.
 * Bottles in stock are never stored: they are purchases minus consumptions.
 */

export const WINE_TYPES = ['red', 'white', 'rose', 'orange', 'sparkling', 'sweet', 'fortified', 'other'] as const;
export type WineType = (typeof WINE_TYPES)[number];

export const WINE_TYPE_LABEL: Record<WineType, string> = {
  red: 'Red',
  white: 'White',
  rose: 'Rosé',
  orange: 'Orange',
  sparkling: 'Sparkling',
  sweet: 'Sweet',
  fortified: 'Fortified',
  other: 'Other',
};

export const REMOVAL_REASONS = ['drunk', 'gifted', 'sold', 'spoiled'] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REMOVAL_REASON_LABEL: Record<RemovalReason, string> = {
  drunk: 'Drank it',
  gifted: 'Gave away',
  sold: 'Sold',
  spoiled: 'Spoiled / corked',
};

export type WindowSource = 'manual' | 'estimate';

export interface Producer {
  id: string;
  name: string;
}

export interface GrapeShare {
  grape: string;
  /** Share of the blend, 0–100. Left out when unknown. */
  percent?: number;
}

export interface Bottling {
  id: string;
  producerId: string;
  name: string;
  type: WineType;
  country?: string;
  region?: string;
  appellation?: string;
  grapes: GrapeShare[];
}

export interface Vintage {
  id: string;
  bottlingId: string;
  /** `null` for non-vintage wines. */
  year: number | null;
  sizeMl: number;
  /** Drinking window, in whole calendar years (inclusive). */
  drinkFrom?: number;
  drinkTo?: number;
  peakFrom?: number;
  peakTo?: number;
  windowSource?: WindowSource;
  location?: string;
  notes?: string;
}

export interface Purchase {
  id: string;
  vintageId: string;
  /** `YYYY-MM-DD`, or the coarser `YYYY-MM` / `YYYY` when only that is known. */
  date?: string;
  quantity: number;
  /** Price per bottle in the cellar currency. */
  unitPrice?: number;
  merchant?: string;
  notes?: string;
}

export interface Consumption {
  id: string;
  vintageId: string;
  date: string;
  quantity: number;
  reason: RemovalReason;
  notes?: string;
}

export interface Settings {
  currency: string;
  /** A window that closes within this many years counts as "drink soon". */
  drinkSoonYears: number;
}

export interface Meta {
  lastBackupAt?: string;
}

export const SCHEMA_VERSION = 1;

export interface CellarData {
  schema: typeof SCHEMA_VERSION;
  producers: Producer[];
  bottlings: Bottling[];
  vintages: Vintage[];
  purchases: Purchase[];
  consumptions: Consumption[];
  settings: Settings;
  meta: Meta;
}

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'AUD', 'CAD', 'JPY', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK'] as const;

export const BOTTLE_SIZES: { ml: number; label: string }[] = [
  { ml: 187, label: '187 ml (piccolo)' },
  { ml: 375, label: '375 ml (half)' },
  { ml: 500, label: '500 ml' },
  { ml: 750, label: '750 ml' },
  { ml: 1000, label: '1 L' },
  { ml: 1500, label: '1.5 L (magnum)' },
  { ml: 3000, label: '3 L (double magnum)' },
  { ml: 4500, label: '4.5 L (jeroboam)' },
  { ml: 6000, label: '6 L (imperial)' },
];

export const STANDARD_BOTTLE_ML = 750;

export function emptyData(): CellarData {
  return {
    schema: SCHEMA_VERSION,
    producers: [],
    bottlings: [],
    vintages: [],
    purchases: [],
    consumptions: [],
    settings: { currency: 'EUR', drinkSoonYears: 1 },
    meta: {},
  };
}
