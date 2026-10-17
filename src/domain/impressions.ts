/**
 * The tasting-descriptor table: words you tap instead of typing. Ids are stable (they are stored
 * with your tasting notes), labels are what you see. Anything not in the table can be added as
 * your own word (stored as `c:<your words>`), and every tasting also has a free-text note.
 */

export interface Impression {
  id: string;
  label: string;
}

export interface ImpressionCategory {
  id: string;
  label: string;
  items: Impression[];
}

const i = (id: string, label: string): Impression => ({ id, label });

export const IMPRESSION_CATEGORIES: ImpressionCategory[] = [
  {
    id: 'fruit',
    label: 'Fruit',
    items: [
      i('citrus', 'Citrus'),
      i('green-apple', 'Green apple'),
      i('pear', 'Pear'),
      i('stone-fruit', 'Peach / apricot'),
      i('tropical', 'Tropical'),
      i('melon', 'Melon'),
      i('red-berries', 'Red berries'),
      i('cherry', 'Cherry'),
      i('blackcurrant', 'Blackcurrant'),
      i('blackberry', 'Blackberry'),
      i('plum', 'Plum'),
      i('dried-fruit', 'Dried fruit'),
      i('fig', 'Fig'),
      i('jam', 'Jammy'),
    ],
  },
  {
    id: 'floral-herbal',
    label: 'Floral and herbal',
    items: [
      i('floral', 'Floral'),
      i('rose', 'Rose'),
      i('violet', 'Violet'),
      i('blossom', 'Blossom'),
      i('herbs', 'Herbs'),
      i('mint', 'Mint'),
      i('eucalyptus', 'Eucalyptus'),
      i('green-pepper', 'Green pepper'),
      i('cut-grass', 'Cut grass'),
      i('tea', 'Tea'),
    ],
  },
  {
    id: 'spice',
    label: 'Spice',
    items: [i('black-pepper', 'Black pepper'), i('liquorice', 'Liquorice'), i('clove', 'Clove'), i('cinnamon', 'Cinnamon'), i('vanilla', 'Vanilla'), i('anise', 'Anise')],
  },
  {
    id: 'oak-age',
    label: 'Oak and age',
    items: [
      i('toast', 'Toast'),
      i('smoke', 'Smoke'),
      i('cedar', 'Cedar'),
      i('butter', 'Butter'),
      i('brioche', 'Brioche'),
      i('nuts', 'Nuts'),
      i('coffee', 'Coffee'),
      i('chocolate', 'Chocolate'),
      i('caramel', 'Caramel'),
      i('honey', 'Honey'),
      i('tobacco', 'Tobacco'),
      i('leather', 'Leather'),
      i('forest-floor', 'Forest floor'),
      i('mushroom', 'Mushroom'),
      i('truffle', 'Truffle'),
      i('game', 'Game'),
    ],
  },
  {
    id: 'earth-mineral',
    label: 'Earth and mineral',
    items: [i('flint', 'Flint'), i('chalk', 'Chalk'), i('wet-stone', 'Wet stone'), i('saline', 'Saline'), i('graphite', 'Graphite'), i('earthy', 'Earthy'), i('petrol', 'Petrol')],
  },
  {
    id: 'structure',
    label: 'Structure',
    items: [
      i('body-light', 'Light body'),
      i('body-medium', 'Medium body'),
      i('body-full', 'Full body'),
      i('tannin-soft', 'Soft tannins'),
      i('tannin-firm', 'Firm tannins'),
      i('tannin-grippy', 'Grippy tannins'),
      i('acidity-low', 'Low acidity'),
      i('acidity-fresh', 'Fresh acidity'),
      i('acidity-high', 'High acidity'),
      i('dry', 'Dry'),
      i('off-dry', 'Off-dry'),
      i('sweet', 'Sweet'),
      i('silky', 'Silky'),
      i('creamy', 'Creamy'),
      i('finish-short', 'Short finish'),
      i('finish-long', 'Long finish'),
      i('balanced', 'Balanced'),
      i('hot', 'Hot / alcoholic'),
    ],
  },
  {
    id: 'verdict',
    label: 'Verdict',
    items: [
      i('too-young', 'Too young'),
      i('drinking-well', 'Drinking well'),
      i('at-peak', 'At its peak'),
      i('past-best', 'Past its best'),
      i('corked', 'Corked'),
      i('oxidised', 'Oxidised'),
      i('reductive', 'Reductive'),
      i('volatile', 'Volatile (vinegary)'),
      i('would-buy-again', 'Would buy again'),
      i('great-value', 'Great value'),
      i('special-occasion', 'Special occasion'),
    ],
  },
];

export const CUSTOM_PREFIX = 'c:';

const builtIn = new Map<string, { label: string; category: string }>();
for (const c of IMPRESSION_CATEGORIES) for (const item of c.items) builtIn.set(item.id, { label: item.label, category: c.id });

export function customImpressionId(label: string): string {
  return `${CUSTOM_PREFIX}${label.trim()}`;
}

export function isCustomImpression(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

/** Human label for a stored impression id; unknown ids degrade to something readable rather than vanishing. */
export function impressionLabel(id: string): string {
  const known = builtIn.get(id);
  if (known) return known.label;
  if (isCustomImpression(id)) return id.slice(CUSTOM_PREFIX.length);
  return id.replace(/-/g, ' ');
}

export function isKnownImpression(id: string): boolean {
  return builtIn.has(id) || (isCustomImpression(id) && id.length > CUSTOM_PREFIX.length);
}
