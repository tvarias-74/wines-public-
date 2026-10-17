import { addConsumption, addWine, type PurchaseInput, type WineInput } from './actions';
import { emptyData, type CellarData } from './types';

export const NOW = new Date(2026, 9, 17);

export function wine(over: Partial<WineInput> = {}): WineInput {
  return {
    producer: 'Château Test',
    bottling: 'Grand Vin',
    type: 'red',
    grapes: [],
    year: 2018,
    sizeMl: 750,
    ...over,
  };
}

export function add(data: CellarData, input: Partial<WineInput>, purchase?: PurchaseInput): { data: CellarData; id: string } {
  const r = addWine(data, wine(input), purchase, NOW);
  if (!r.ok) throw new Error(r.error);
  return { data: r.data, id: r.vintageId };
}

export function drink(data: CellarData, vintageId: string, quantity = 1): CellarData {
  const r = addConsumption(data, vintageId, { date: '2026-01-01', quantity, reason: 'drunk' });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export { emptyData };
