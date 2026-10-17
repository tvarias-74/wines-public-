import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { moveBottles, placeBottles, suggestPlacement, unplaceBottles, type PlacementInput } from '../domain/actions';
import { locationFills, occupancyOf, type WineRow } from '../domain/inventory';
import { locationShortName, pluralize } from '../domain/text';
import { LOCATION_KIND_LABEL, BOX_MATERIAL_LABEL, type CellarData, type Location } from '../domain/types';
import { useCellar } from '../storage/store';
import { Field, Stepper } from './forms';
import { Icon } from './Icon';
import { Modal, useToast } from './overlays';

/** "Division 12 — 9 free" / "Wooden box — 4 free" / "Fridge" (no limit). */
export function locationOptionLabel(data: CellarData, l: Location): string {
  if (l.capacity === undefined) return l.name;
  const free = Math.max(0, l.capacity - occupancyOf(data, l.id));
  return `${l.name} — ${free} free`;
}

interface Row {
  key: number;
  locationId: string;
  qty: string;
}

/**
 * Chooses where a number of bottles will go. It starts from a suggestion (keeping a wine together)
 * and the choice is always yours: add places, change counts, or leave it for later.
 */
export function PlacementPicker({
  data,
  quantity,
  vintageId,
  hint,
  onChange,
}: {
  data: CellarData;
  quantity: number;
  vintageId: string | null;
  hint?: { bottlingId?: string; producerId?: string };
  onChange: (plan: PlacementInput[], problem: string | null) => void;
}) {
  const fills = useMemo(() => locationFills(data), [data]);
  const touched = useRef(false);
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [later, setLater] = useState(false);

  const suggestion = useMemo(() => (quantity > 0 ? suggestPlacement(data, vintageId, quantity, hint) : { plan: [], leftover: 0 }), [data, vintageId, quantity, hint?.bottlingId, hint?.producerId]); // eslint-disable-line

  // Follow the suggestion until you change something yourself.
  useEffect(() => {
    if (touched.current) return;
    setRows(suggestion.plan.map((p) => ({ key: nextKey.current++, locationId: p.locationId, qty: String(p.quantity) })));
  }, [suggestion]);

  // With no bottles to place (the count was set to 0), nothing is planned, whatever rows were left behind.
  const plan: PlacementInput[] = later || quantity < 1 ? [] : rows.map((r) => ({ locationId: r.locationId, quantity: Number(r.qty) || 0 })).filter((p) => p.locationId && p.quantity > 0);
  const total = plan.reduce((n, p) => n + p.quantity, 0);

  const problem = useMemo(() => {
    if (later) return null;
    if (total > quantity) return `That is ${total - quantity} more than the ${pluralize(quantity, 'bottle')} you are adding.`;
    const per = new Map<string, number>();
    for (const p of plan) per.set(p.locationId, (per.get(p.locationId) ?? 0) + p.quantity);
    for (const [id, n] of per) {
      const l = data.locations.find((x) => x.id === id);
      if (l?.capacity !== undefined && n > l.capacity - occupancyOf(data, id)) return `${l.name} has room for only ${Math.max(0, l.capacity - occupancyOf(data, id))} more.`;
    }
    return null;
  }, [later, total, quantity, plan, data]); // eslint-disable-line

  useEffect(() => onChange(plan, problem), [JSON.stringify(plan), problem]); // eslint-disable-line

  if (!data.locations.length) {
    return (
      <p className="notice span-2">
        <Icon name="pin" size={16} /> Want to record where bottles are kept? <Link to="/layout">Set up your cellar layout</Link> (for example, 50 divisions of 15 bottles).
      </p>
    );
  }
  if (quantity < 1) return null;

  const edit = (key: number, patch: Partial<Row>) => {
    touched.current = true;
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  return (
    <div className="placement-picker span-2">
      <div className="placement-head">
        <strong>Where will {quantity === 1 ? 'it' : 'they'} go?</strong>
        <label className="check check-sm">
          <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
          Decide later
        </label>
      </div>
      {!later && (
        <>
          {rows.map((r, i) => (
            <div className="placement-row" key={r.key}>
              <select aria-label={`Place ${i + 1}`} value={r.locationId} onChange={(e) => edit(r.key, { locationId: e.target.value })}>
                <option value="">Choose a place…</option>
                {fills.map((f) => (
                  <option key={f.location.id} value={f.location.id}>
                    {locationOptionLabel(data, f.location)}
                  </option>
                ))}
              </select>
              <input aria-label={`Bottles in place ${i + 1}`} className="qty-input" inputMode="numeric" value={r.qty} onChange={(e) => edit(r.key, { qty: e.target.value.replace(/\D/g, '') })} />
              <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label={`Remove place ${i + 1}`} onClick={() => { touched.current = true; setRows((rs) => rs.filter((x) => x.key !== r.key)); }}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          <div className="placement-foot">
            <button type="button" className="btn btn-sm" onClick={() => { touched.current = true; setRows((rs) => [...rs, { key: nextKey.current++, locationId: '', qty: String(Math.max(0, quantity - total)) }]); }}>
              <Icon name="plus" size={16} /> Another place
            </button>
            {touched.current && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => { touched.current = false; setRows(suggestion.plan.map((p) => ({ key: nextKey.current++, locationId: p.locationId, qty: String(p.quantity) }))); }}>
                Suggest again
              </button>
            )}
            <span className={`placement-total${total === quantity ? ' is-ok' : ''}`}>
              {total} of {quantity} placed
            </span>
          </div>
          {suggestion.leftover > 0 && !touched.current && <p className="field-hint">There is room for only {quantity - suggestion.leftover} of them; add a floor box or another place in your layout for the rest.</p>}
          {problem && <p className="field-error">{problem}</p>}
        </>
      )}
    </div>
  );
}

/** Puts bottles that have no place yet where you choose. */
export function PlaceDialog({ row, onClose }: { row: WineRow; onClose: () => void }) {
  const { data, apply } = useCellar();
  const toast = useToast();
  const [plan, setPlan] = useState<PlacementInput[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const r = apply((d) => {
      let cur = d;
      for (const p of plan) {
        const res = placeBottles(cur, row.vintage.id, p.locationId, p.quantity);
        if (!res.ok) return res;
        cur = res.data;
      }
      return { ok: true as const, data: cur };
    });
    if (!r.ok) return setError(r.error);
    toast(`Put away ${pluralize(plan.reduce((n, p) => n + p.quantity, 0), 'bottle')}`);
    onClose();
  };

  return (
    <Modal
      title="Put bottles away"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!plan.length || !!problem}>Save places</button>
        </>
      }
    >
      <p className="modal-text">{pluralize(row.unplaced, 'bottle')} of this wine {row.unplaced === 1 ? 'has' : 'have'} no place yet.</p>
      <div className="form-grid">
        <PlacementPicker data={data} quantity={row.unplaced} vintageId={row.vintage.id} onChange={(p, pr) => { setPlan(p); setProblem(pr); setError(null); }} />
      </div>
      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}

/** Moves some or all of a wine's bottles from one place to another, or takes them out of a place without drinking them. */
export function MoveDialog({ row, from, onClose }: { row: WineRow; from: Location; onClose: () => void }) {
  const { data, apply } = useCellar();
  const toast = useToast();
  const here = row.placements.find((p) => p.location.id === from.id)?.quantity ?? 0;
  const [to, setTo] = useState('');
  const [qty, setQty] = useState(here);
  const [error, setError] = useState<string | null>(null);
  const others = locationFills(data).filter((f) => f.location.id !== from.id);
  const q = Number.isFinite(qty) ? Math.min(Math.max(1, qty), Math.max(1, here)) : 1;

  const move = () => {
    if (!to) return setError('Choose where to move them');
    const r = apply((d) => moveBottles(d, row.vintage.id, from.id, to, q));
    if (!r.ok) return setError(r.error);
    toast(`Moved ${pluralize(q, 'bottle')} to ${data.locations.find((l) => l.id === to)?.name ?? 'the new place'}`);
    onClose();
  };
  const unplace = () => {
    const r = apply((d) => unplaceBottles(d, row.vintage.id, from.id, q));
    if (!r.ok) return setError(r.error);
    toast(`${pluralize(q, 'bottle')} taken out of ${from.name} (not drunk)`);
    onClose();
  };

  return (
    <Modal
      title={`Move from ${from.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={move}>Move</button>
        </>
      }
    >
      <p className="modal-text">{pluralize(here, 'bottle')} here.</p>
      <div className="form-grid">
        <Field label="How many?" error={undefined}>
          {(id) => <Stepper id={id} label="Bottles to move" value={q} min={1} max={here} onChange={setQty} />}
        </Field>
        <Field label="Move to" className="span-2" error={error ?? undefined}>
          {(id, d) => (
            <select id={id} value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} aria-describedby={d}>
              <option value="">Choose a place…</option>
              {others.map((f) => (
                <option key={f.location.id} value={f.location.id} disabled={f.full}>
                  {locationOptionLabel(data, f.location)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="card-foot">
        <button className="btn btn-quiet btn-sm" onClick={unplace}>
          Take {q === 1 ? 'it' : 'them'} out of {from.name} without moving
        </button>
      </p>
    </Modal>
  );
}

export function locationSubtitle(l: Location, used: number): string {
  const kind = l.kind === 'box' ? (l.material ? BOX_MATERIAL_LABEL[l.material] : LOCATION_KIND_LABEL.box) : LOCATION_KIND_LABEL[l.kind];
  return l.capacity !== undefined ? `${kind} · ${used} of ${l.capacity} bottles` : `${kind} · ${pluralize(used, 'bottle')}`;
}

export { locationShortName };
