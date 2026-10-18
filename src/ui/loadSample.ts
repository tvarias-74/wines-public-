import { buildSampleData } from '../domain/sample';
import type { Result } from '../domain/actions';
import type { CellarData } from '../domain/types';
import { attachSampleLabels } from '../storage/sampleImages';

type Apply = <T extends { data: CellarData }>(fn: (d: CellarData) => Result<T>) => Result<T>;

/**
 * Adds the demo cellar, with its drawn labels, to the cellar as it is *when the labels are ready*.
 * Drawing them takes a moment; anything you do in the meantime is kept, not written over.
 */
export async function addSampleWines(apply: Apply, snapshot: CellarData): Promise<void> {
  const labelled = await attachSampleLabels(buildSampleData(snapshot));
  apply((latest) => {
    if (latest === snapshot) return { ok: true as const, data: labelled };
    // The cellar changed while the labels were drawn: build the demo on the latest data (same ids, as
    // nothing about the demo changed) and give its wines the labels that were drawn.
    const rebuilt = buildSampleData(latest);
    const pictures = new Map(labelled.vintages.filter((v) => v.images).map((v) => [v.id, v.images]));
    return { ok: true as const, data: { ...rebuilt, vintages: rebuilt.vintages.map((v) => (pictures.has(v.id) && !v.images ? { ...v, images: pictures.get(v.id) } : v)) } };
  });
}
