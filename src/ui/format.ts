import type { Bottling, GrapeShare } from '../domain/types';
import { WINE_TYPE_LABEL } from '../domain/types';

export function grapesLabel(grapes: GrapeShare[]): string {
  return grapes.map((g) => (g.percent !== undefined ? `${g.grape} ${g.percent}%` : g.grape)).join(', ');
}

/** "Red · Saint-Émilion Grand Cru · Merlot 80%, Cabernet Franc 20%" */
export function bottlingSummary(b: Bottling): string {
  return [WINE_TYPE_LABEL[b.type], b.appellation ?? b.region, b.country, grapesLabel(b.grapes)].filter(Boolean).join(' · ');
}

export function downloadFile(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
