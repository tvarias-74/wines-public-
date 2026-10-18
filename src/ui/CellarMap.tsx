import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { locationFills, wineTitle, type WineRow } from '../domain/inventory';
import { locationShortName, pluralize } from '../domain/text';
import type { Location } from '../domain/types';
import { useCellar } from '../storage/store';
import { Icon } from './Icon';
import { Card, EmptyNote } from './components';
import { ConsumeDialog } from './Tasting';
import { Modal } from './overlays';
import { MoveDialog, PlaceDialog, locationSubtitle } from './Placement';

/**
 * The cellar at a glance: every division as a tile showing how full it is, boxes on the floor
 * below, and a worklist of bottles that have no place yet. While filters or a search are active,
 * tiles without a matching bottle fade and the rest show how many match.
 */
export function CellarMap({ allRows, rows, filtered }: { allRows: WineRow[]; rows: WineRow[]; filtered: boolean }) {
  const { data } = useCellar();
  const [open, setOpen] = useState<Location | null>(null);
  const [placing, setPlacing] = useState<WineRow | null>(null);
  const fills = useMemo(() => locationFills(data), [data]);

  const matches = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const p of r.placements) m.set(p.location.id, (m.get(p.location.id) ?? 0) + p.quantity);
    return m;
  }, [rows]);

  const unplaced = allRows.filter((r) => r.bottles > 0 && r.unplaced > 0).sort((a, b) => b.unplaced - a.unplaced);
  const divisions = fills.filter((f) => f.location.kind === 'division');
  const others = fills.filter((f) => f.location.kind !== 'division');
  const total = fills.reduce((n, f) => n + f.used, 0);
  const capacity = divisions.reduce((n, f) => n + (f.location.capacity ?? 0), 0);

  if (!data.locations.length) {
    return (
      <Card>
        <div className="welcome">
          <h2>Map your cellar</h2>
          <p>Create your divisions once (for example 50 of 15 bottles), then each wine gets a place when you add it. You will see at a glance what is where, and how much room is left.</p>
          <div className="welcome-actions">
            <Link className="btn btn-primary" to="/layout">
              <Icon name="plus" size={18} /> Set up the layout
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  const tile = (f: (typeof fills)[number]) => {
    const hit = matches.get(f.location.id) ?? 0;
    const dim = filtered && hit === 0;
    return (
      <button
        key={f.location.id}
        type="button"
        className={`cell${f.used === 0 ? ' is-empty' : ''}${f.full ? ' is-full' : ''}${dim ? ' is-dim' : ''}${filtered && hit > 0 ? ' is-hit' : ''}`}
        style={{ '--fill': f.fill } as CSSProperties}
        onClick={() => setOpen(f.location)}
        aria-label={`${f.location.name}: ${f.location.capacity !== undefined ? `${f.used} of ${f.location.capacity}` : f.used} bottles${filtered ? `, ${hit} match` : ''}`}
      >
        <span className="cell-name">{locationShortName(f.location.name)}</span>
        <span className="cell-count">{filtered ? <b>{hit}</b> : f.used}{f.location.capacity !== undefined && !filtered ? <small>/{f.location.capacity}</small> : null}</span>
        <span className="cell-bar" aria-hidden="true" />
      </button>
    );
  };

  return (
    <>
      <Card
        title="Divisions"
        subtitle={`${pluralize(total, 'bottle')} placed${capacity ? ` · room for ${pluralize(Math.max(0, capacity - divisions.reduce((n, f) => n + f.used, 0)), 'more bottle')} in the divisions` : ''}`}
        action={
          <Link className="link-quiet" to="/layout">
            Edit layout <Icon name="chevron" size={16} />
          </Link>
        }
      >
        {divisions.length ? <div className="cells">{divisions.map(tile)}</div> : <EmptyNote>No divisions yet.</EmptyNote>}
        {filtered && <p className="card-foot muted">Showing where the wines that match your filters are. Clear them to see how full each division is.</p>}
      </Card>

      {others.length > 0 && (
        <Card title="Boxes and other places">
          <div className="cells cells-wide">{others.map(tile)}</div>
        </Card>
      )}

      {unplaced.length > 0 && (
        <Card title="Not put away yet" subtitle={`${pluralize(unplaced.reduce((n, r) => n + r.unplaced, 0), 'bottle')} of ${pluralize(unplaced.length, 'wine')} ${unplaced.length === 1 ? 'has' : 'have'} no place recorded.`}>
          <ul className="plain-list">
            {unplaced.map((r) => (
              <li key={r.vintage.id} className="attn-row">
                <Link to={`/wine/${r.vintage.id}`}>
                  <span className="attn-title">{wineTitle(r)}</span>
                </Link>
                <span className="attn-count">{pluralize(r.unplaced, 'bottle')}</span>
                <button className="btn btn-sm" onClick={() => setPlacing(r)}>
                  <Icon name="pin" size={16} /> Put away
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {open && <LocationDialog location={open} allRows={allRows} onClose={() => setOpen(null)} />}
      {placing && <PlaceDialog row={placing} onClose={() => setPlacing(null)} />}
    </>
  );
}

/** What is in one place, with the things you do there: move it, or drink it. */
function LocationDialog({ location, allRows, onClose }: { location: Location; allRows: WineRow[]; onClose: () => void }) {
  const [moving, setMoving] = useState<WineRow | null>(null);
  const [drinking, setDrinking] = useState<WineRow | null>(null);
  const inside = allRows
    .map((r) => ({ row: r, qty: r.placements.find((p) => p.location.id === location.id)?.quantity ?? 0 }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  const used = inside.reduce((n, x) => n + x.qty, 0);

  // The dialogs below replace this one while they are open, so closing them returns here.
  if (moving) return <MoveDialog row={moving} from={location} onClose={() => setMoving(null)} />;
  if (drinking) return <ConsumeDialog row={drinking} presetLocationId={location.id} onClose={() => setDrinking(null)} />;

  return (
    <div>
      <ModalShell title={location.name} subtitle={locationSubtitle(location, used)} onClose={onClose}>
        {inside.length === 0 ? (
          <EmptyNote>Nothing is kept here.</EmptyNote>
        ) : (
          <ul className="ledger">
            {inside.map(({ row, qty }) => (
              <li key={row.vintage.id}>
                <div>
                  <Link to={`/wine/${row.vintage.id}`} onClick={onClose}>
                    <strong>{wineTitle(row)}</strong>
                  </Link>
                  <span className="muted"> · {pluralize(qty, 'bottle')}</span>
                </div>
                <span className="ledger-actions">
                  <button className="btn btn-quiet btn-sm" onClick={() => setMoving(row)}>Move</button>
                  <button className="btn btn-quiet btn-sm" onClick={() => setDrinking(row)}>Drink</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ModalShell>
    </div>
  );
}


function ModalShell({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="modal-text">{subtitle}</p>
      {children}
    </Modal>
  );
}
