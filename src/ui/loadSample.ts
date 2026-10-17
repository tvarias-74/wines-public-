import { buildSampleData } from '../domain/sample';
import { emptyData, type CellarData } from '../domain/types';
import { attachSampleLabels } from '../storage/sampleImages';

/** The demo cellar with its placeholder labels, added on top of whatever you already have. */
export async function sampleWines(base: CellarData = emptyData()): Promise<CellarData> {
  return attachSampleLabels(buildSampleData(base));
}
