import type { Bottling, GrapeShare } from '../domain/types';
import { bottlingKindLabel } from '../domain/text';
import type { WineRow } from '../domain/inventory';
import { formatYear } from '../domain/text';

export function grapesLabel(grapes: GrapeShare[]): string {
  return grapes.map((g) => (g.percent !== undefined ? `${g.grape} ${g.percent}%` : g.grape)).join(', ');
}

/** "Red · Saint-Émilion Grand Cru · France · Merlot 80%, Cabernet Franc 20%" */
export function bottlingSummary(b: Bottling): string {
  return [bottlingKindLabel(b), b.appellation ?? b.region, b.country, grapesLabel(b.grapes)].filter(Boolean).join(' · ');
}

/** "Division 12 ×6 · Division 13 ×3", or null when no bottle of this wine has a place. */
export function placementsLabel(row: WineRow, max = 2): string | null {
  if (!row.placements.length) return null;
  const shown = row.placements.slice(0, max).map((p) => `${p.location.name} ×${p.quantity}`);
  const more = row.placements.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` · +${more} more` : '');
}

export function downloadFile(filename: string, contents: string | Blob, mime = 'application/octet-stream'): void {
  const blob = typeof contents === 'string' ? new Blob([contents], { type: `${mime};charset=utf-8` }) : contents;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export interface ReviewSearch {
  label: string;
  url: string;
}

/**
 * Where to look for a wine's reviews. These are ordinary web searches limited to each site: the
 * app cannot fetch the reviews itself (Vivino has no public API, and Wine Advocate and
 * JancisRobinson.com are paid services), so it takes you there and lets you record what you find.
 */
export function reviewSearches(row: Pick<WineRow, 'producer' | 'bottling' | 'vintage'>): ReviewSearch[] {
  const wine = `${row.producer.name} ${row.bottling.name} ${row.vintage.year ?? ''}`.trim();
  const q = (site: string) => `https://www.google.com/search?q=${encodeURIComponent(`${wine} site:${site}`)}`;
  return [
    { label: 'Vivino', url: q('vivino.com') },
    { label: 'Wine Advocate (Robert Parker)', url: q('robertparker.com') },
    { label: 'Jancis Robinson', url: q('jancisrobinson.com') },
  ];
}

export { formatYear };
