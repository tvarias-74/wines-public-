import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addLocation, createDivisions, deleteLocation, updateLocation, updateSettings, type FieldErrors, type LocationInput } from '../../domain/actions';
import { locationFills } from '../../domain/inventory';
import { pluralize } from '../../domain/text';
import { BOX_MATERIALS, BOX_MATERIAL_LABEL, LOCATION_KINDS, LOCATION_KIND_LABEL, type Location, type LocationKind, type BoxMaterial } from '../../domain/types';
import { useCellar } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, EmptyNote, Field, PageHead } from '../components';
import { Modal, useConfirm, useToast } from '../overlays';
import { locationSubtitle } from '../Placement';

export function Layout() {
  const { data, apply } = useCellar();
  const toast = useToast();
  const confirm = useConfirm();
  const fills = locationFills(data);
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('50');
  const [capacity, setCapacity] = useState(String(data.settings.divisionCapacity));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  const setup = () => {
    const cap = Number(capacity);
    const r = apply((d) => {
      const made = createDivisions(d, { from: Number(from), to: Number(to), capacity: cap });
      if (!made.ok) return made;
      return { ok: true as const, data: updateSettings(made.data, { divisionCapacity: cap }), created: made.created };
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    toast(r.created ? `Created ${pluralize(r.created, 'division')}` : 'Those divisions already exist');
  };

  const remove = async (l: Location) => {
    if (!(await confirm({ title: `Delete ${l.name}?`, message: 'The place is removed from your layout. It must be empty.', confirmLabel: 'Delete', danger: true }))) return;
    const r = apply((d) => deleteLocation(d, l.id));
    if (!r.ok) toast(r.error, { tone: 'error' });
  };

  const divisions = fills.filter((f) => f.location.kind === 'division');
  const totalCapacity = divisions.reduce((n, f) => n + (f.location.capacity ?? 0), 0);

  return (
    <>
      <Link className="back-link" to="/cellar?view=map">
        <Icon name="back" size={18} /> Cellar map
      </Link>
      <PageHead title="Cellar layout" subtitle="The places your bottles are kept: numbered divisions, boxes on the floor, a fridge…" />

      <Card title="Create numbered divisions" subtitle={divisions.length ? `You have ${pluralize(divisions.length, 'division')} holding up to ${pluralize(totalCapacity, 'bottle')}.` : 'One step creates them all. You can rename or resize any of them afterwards.'}>
        <div className="form-grid form-grid-3">
          <Field label="From number">{(id) => <input id={id} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="To number">{(id) => <input id={id} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="Bottles each">{(id) => <input id={id} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} />}</Field>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={setup}>
            <Icon name="plus" size={18} /> Create divisions
          </button>
          <button className="btn" onClick={() => setEditing('new')}>
            <Icon name="box" size={18} /> Add a box or other place
          </button>
        </div>
      </Card>

      <Card title="Your places" className={fills.length ? 'flush' : undefined}>
        {fills.length === 0 ? (
          <EmptyNote>No places yet. Create your divisions above, then give each wine a place when you add it.</EmptyNote>
        ) : (
          <ul className="ledger loc-list">
            {fills.map((f) => (
              <li key={f.location.id}>
                <div>
                  <strong>{f.location.name}</strong>
                  <span className="muted"> · {locationSubtitle(f.location, f.used)}</span>
                </div>
                <span className="ledger-actions">
                  <button className="btn btn-quiet btn-sm" onClick={() => setEditing(f.location)} aria-label={`Edit ${f.location.name}`}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    className="btn btn-quiet btn-sm"
                    onClick={() => (f.used > 0 ? toast(`${f.location.name} still holds ${pluralize(f.used, 'bottle')}. Move them out first.`, { tone: 'error' }) : remove(f.location))}
                    aria-label={`Delete ${f.location.name}`}
                    aria-disabled={f.used > 0 || undefined}
                    title={f.used > 0 ? 'Move the bottles out first' : undefined}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <LocationDialog location={editing === 'new' ? null : editing} defaultCapacity={Number(capacity) || 15} onClose={() => setEditing(null)} />}
    </>
  );
}

function LocationDialog({ location, defaultCapacity, onClose }: { location: Location | null; defaultCapacity: number; onClose: () => void }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [name, setName] = useState(location?.name ?? '');
  const [kind, setKind] = useState<LocationKind>(location?.kind ?? 'box');
  const [capacity, setCapacity] = useState(location?.capacity !== undefined ? String(location.capacity) : location ? '' : kind === 'division' ? String(defaultCapacity) : '');
  const [material, setMaterial] = useState<BoxMaterial | ''>(location?.material ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: LocationInput = { name, kind, capacity: capacity.trim() === '' ? undefined : Number(capacity), material: kind === 'box' && material ? material : undefined };
    const r = apply((d) => (location ? updateLocation(d, location.id, input) : addLocation(d, input)));
    if (!r.ok) return setErrors(r.fieldErrors ?? { name: r.error });
    toast(location ? 'Saved' : `Added ${name.trim()}`);
    onClose();
  };

  return (
    <Modal
      title={location ? `Edit ${location.name}` : 'Add a place'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>{location ? 'Save' : 'Add'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" error={errors.name} className="span-2">
          {(id, d) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wooden box — Haut-Verger 2010" aria-describedby={d} autoCapitalize="sentences" />}
        </Field>
        <Field label="Kind" error={errors.kind}>
          {(id) => (
            <select id={id} value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>{LOCATION_KIND_LABEL[k]}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Holds up to (bottles)" error={errors.capacity} hint="Leave empty for no limit">
          {(id, d) => <input id={id} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} aria-describedby={d} />}
        </Field>
        {kind === 'box' && (
          <Field label="Material" className="span-2">
            {(id) => (
              <select id={id} value={material} onChange={(e) => setMaterial(e.target.value as BoxMaterial | '')}>
                <option value="">Not specified</option>
                {BOX_MATERIALS.map((m) => (
                  <option key={m} value={m}>{BOX_MATERIAL_LABEL[m]}</option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
