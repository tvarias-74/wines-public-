import { addConsumption, addWine, type PurchaseInput, type WineInput } from './actions';
import { emptyData, type CellarData } from './types';

export const NOW = new Date(2026, 9, 17);

export function wine(over: Partial<WineInput> = {}): WineInput {
  return {
    producer: 'Château Test',
    bottling: 'Grand Vin',
    colour: 'red',
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

import { addLocation, createDivisions, placeBottles, type LocationInput } from './actions';

/** Adds `count` divisions of `capacity` bottles (Division 1…count). */
export function withDivisions(data: CellarData, count = 3, capacity = 15): CellarData {
  const r = createDivisions(data, { from: 1, to: count, capacity });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export function withLocation(data: CellarData, input: LocationInput): { data: CellarData; id: string } {
  const r = addLocation(data, input);
  if (!r.ok) throw new Error(r.error);
  return { data: r.data, id: r.locationId };
}

export function locId(data: CellarData, name: string): string {
  const l = data.locations.find((x) => x.name === name);
  if (!l) throw new Error(`no location ${name}`);
  return l.id;
}

export function place(data: CellarData, vintageId: string, locationName: string, qty: number): CellarData {
  const r = placeBottles(data, vintageId, locId(data, locationName), qty);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
