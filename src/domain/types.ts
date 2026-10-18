/**
 * The cellar is stored as one document. A wine is described on three levels,
 * mirroring how collectors talk about their bottles:
 *
 *   Group (owner family/company, optional)
 *     └─ Producer (the winery)
 *          └─ Bottling (the label / cuvée)
 *               └─ Vintage (a year, in a bottle size)
 *
 * Grape varieties, colour and origin belong to the bottling, the drinking
 * window and the label photos to the vintage. Bottles in stock are never stored:
 * they are purchases minus consumptions. Where the bottles *are* is a separate
 * ledger of placements (vintage × location × quantity).
 */

export const COLOURS = ['red', 'rose', 'white', 'orange'] as const;
export type Colour = (typeof COLOURS)[number];

export const COLOUR_LABEL: Record<Colour, string> = {
  red: 'Red',
  rose: 'Rosé',
  white: 'White',
  orange: 'Orange',
};

/** Optional extras that are neither a colour nor "sparkling". */
export const WINE_STYLES = ['sweet', 'fortified'] as const;
export type WineStyle = (typeof WINE_STYLES)[number];

export const WINE_STYLE_LABEL: Record<WineStyle, string> = {
  sweet: 'Sweet',
  fortified: 'Fortified',
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

/** The family or company that owns one or more wineries (e.g. Antinori), possibly in several regions or countries. */
export interface Group {
  id: string;
  name: string;
}

export interface Producer {
  id: string;
  name: string;
  groupId?: string;
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
  /** Left out when unknown (for example, imported from a sheet with no colour column). */
  colour?: Colour;
  sparkling: boolean;
  style?: WineStyle;
  country?: string;
  region?: string;
  appellation?: string;
  grapes: GrapeShare[];
  /**
   * Barcodes (canonical GTINs) printed on this bottling's bottles. They are shared by every vintage,
   * as producers usually keep one barcode across years: scanning finds the bottling, you pick the year.
   */
  barcodes?: string[];
}

/** Ids of photos held in the image store (kept apart from this document because of their size). */
export interface VintageImages {
  front?: string;
  back?: string;
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
  images?: VintageImages;
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

export const LOCATION_KINDS = ['division', 'box', 'other'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  division: 'Division',
  box: 'Floor box',
  other: 'Other',
};

export const BOX_MATERIALS = ['wooden', 'carton'] as const;
export type BoxMaterial = (typeof BOX_MATERIALS)[number];

export const BOX_MATERIAL_LABEL: Record<BoxMaterial, string> = {
  wooden: 'Wooden box',
  carton: 'Carton',
};

/** A place bottles can be: a numbered division in the cellar, a box on the floor, a fridge… */
export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  /** Most bottles it can hold. Left out when there is no practical limit. */
  capacity?: number;
  material?: BoxMaterial;
}

/** `quantity` bottles of a vintage sit in a location. At most one placement per vintage and location. */
export interface Placement {
  id: string;
  vintageId: string;
  locationId: string;
  quantity: number;
}

export const RATING_MIN = 1;
export const RATING_MAX = 20;
export const RATING_STEP = 0.5;

export interface Consumption {
  id: string;
  vintageId: string;
  date: string;
  quantity: number;
  reason: RemovalReason;
  /** Where the bottles were taken from, when the cellar layout is in use. */
  locationId?: string;
  /** Free-form impressions. */
  notes?: string;
  /** Your score, 1–20 in half-point steps. */
  rating?: number;
  /** Ids from the tasting-descriptor table (or `c:Your own words` for custom ones). */
  impressions?: string[];
}

export const REVIEW_SOURCES = ['vivino', 'parker', 'robinson', 'other'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_SOURCE_LABEL: Record<ReviewSource, string> = {
  vivino: 'Vivino',
  parker: 'Robert Parker / Wine Advocate',
  robinson: 'Jancis Robinson',
  other: 'Other',
};

/** The scale each well-known source normally uses. */
export const REVIEW_SOURCE_SCALE: Record<ReviewSource, number> = {
  vivino: 5,
  parker: 100,
  robinson: 20,
  other: 100,
};

/** Someone else's opinion, typed in by you (with a link back to the source). */
export interface Review {
  id: string;
  vintageId: string;
  source: ReviewSource;
  /** Who, when `source` is "other" (e.g. Decanter, James Suckling). */
  sourceName?: string;
  score?: number;
  /** The top of the scale `score` is out of (5, 20, 100…). */
  scale?: number;
  reviewer?: string;
  text?: string;
  date?: string;
  url?: string;
  /** The critic's own drinking window, if given. */
  drinkFrom?: number;
  drinkTo?: number;
}

export interface Settings {
  currency: string;
  /** A window that closes within this many years counts as "drink soon". */
  drinkSoonYears: number;
  /** Bottles per division, used when creating divisions. */
  divisionCapacity: number;
  /** Tasting words you added yourself, on top of the built-in table. */
  customImpressions: string[];
}

export interface Meta {
  lastBackupAt?: string;
}

export const SCHEMA_VERSION = 3;

export interface CellarData {
  schema: typeof SCHEMA_VERSION;
  groups: Group[];
  producers: Producer[];
  bottlings: Bottling[];
  vintages: Vintage[];
  purchases: Purchase[];
  consumptions: Consumption[];
  locations: Location[];
  placements: Placement[];
  reviews: Review[];
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
  { ml: 3000, label: '3 L (double magnum / jeroboam)' },
  { ml: 4500, label: '4.5 L (rehoboam)' },
  { ml: 6000, label: '6 L (imperial)' },
];

export const STANDARD_BOTTLE_ML = 750;
export const DEFAULT_DIVISION_CAPACITY = 15;

export function defaultSettings(): Settings {
  return { currency: 'EUR', drinkSoonYears: 1, divisionCapacity: DEFAULT_DIVISION_CAPACITY, customImpressions: [] };
}

export function emptyData(): CellarData {
  return {
    schema: SCHEMA_VERSION,
    groups: [],
    producers: [],
    bottlings: [],
    vintages: [],
    purchases: [],
    consumptions: [],
    locations: [],
    placements: [],
    reviews: [],
    settings: defaultSettings(),
    meta: {},
  };
}
