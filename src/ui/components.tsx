import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addConsumption, deleteConsumption, type FieldErrors } from '../domain/actions';
import { wineTitle, type WineRow } from '../domain/inventory';
import { REMOVAL_REASONS, REMOVAL_REASON_LABEL, type RemovalReason } from '../domain/types';
import { formatMoney, formatYear, pluralize, sizeBadge, toIsoDate } from '../domain/text';
import { describeStatus, formatWindow, windowOf } from '../domain/window';
import { useCellar } from '../storage/store';
import { Icon } from './Icon';
import { Modal, useToast } from './overlays';
import { StatusBadge } from './status';

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, action, children, className }: { title?: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: (id: string, describedBy: string | undefined) => ReactNode; className?: string }) {
  const id = useId();
  const msgId = `${id}-msg`;
  const describedBy = error || hint ? msgId : undefined;
  return (
    <div className={`field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, describedBy)}
      {(error || hint) && (
        <p id={msgId} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max?: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="btn btn-icon" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="One fewer">
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Math.round(Number(e.target.value)))}
        onBlur={() => onChange(Number.isFinite(value) ? clamp(value) : min)}
        aria-label={label}
      />
      <button type="button" className="btn btn-icon" onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max} aria-label="One more">
        +
      </button>
    </div>
  );
}

/** A date field that is a native picker normally, and plain text only to preserve an imported year-only date. */
export function DateField({ id, value, onChange, describedBy, name }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string; name?: string }) {
  const [asText] = useState(value !== '' && value.length !== 10);
  return asText ? (
    <input id={id} name={name} type="text" value={value} placeholder="YYYY, YYYY-MM or YYYY-MM-DD" onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} />
  ) : (
    <input id={id} name={name} type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} />
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

/** Opens the "take bottles out" dialog and handles undo through a toast. */
export function ConsumeDialog({ row, onClose }: { row: WineRow; onClose: () => void }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [reason, setReason] = useState<RemovalReason>('drunk');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const r = apply((d) => addConsumption(d, row.vintage.id, { date, quantity, reason, notes }));
    if (!r.ok) {
      setErrors(r.fieldErrors ?? { quantity: r.error });
      return;
    }
    const left = row.bottles - quantity;
    const verb = reason === 'drunk' ? 'Enjoyed' : reason === 'sold' ? 'Sold' : reason === 'gifted' ? 'Gave away' : 'Removed';
    toast(`${verb} ${pluralize(quantity, 'bottle')} of ${wineTitle(row)} · ${left} left`, {
      action: { label: 'Undo', onClick: () => apply((d) => ({ ok: true as const, data: deleteConsumption(d, r.consumptionId) })) },
    });
    onClose();
  };

  return (
    <Modal
      title="Take bottles out"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Confirm
          </button>
        </>
      }
    >
      <p className="modal-text">
        <strong>{wineTitle(row)}</strong>
        <br />
        {pluralize(row.bottles, 'bottle')} in the cellar
      </p>
      <div className="form-grid">
        <Field label="How many?" error={errors.quantity}>
          {() => <Stepper label="Bottles" value={quantity} min={1} max={row.bottles} onChange={setQuantity} />}
        </Field>
        <Field label="Date" error={errors.date}>
          {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="What happened?" className="span-2">
          {(id) => (
            <select id={id} value={reason} onChange={(e) => setReason(e.target.value as RemovalReason)}>
              {REMOVAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REMOVAL_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Notes (optional)" className="span-2">
          {(id) => <textarea id={id} rows={2} value={notes} placeholder="Occasion, how it tasted…" onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/** One vintage in a list. `showTitle` adds the producer and bottling (flat lists); trees already show them above. */
export function WineRowItem({ row, showTitle, onDrink, currency, nowYear }: { row: WineRow; showTitle?: boolean; onDrink: (row: WineRow) => void; currency: string; nowYear: number }) {
  const w = windowOf(row.vintage);
  const finished = row.bottles === 0;
  const detail = finished ? '' : describeStatus(w, row.status, nowYear);
  const badge = sizeBadge(row.vintage.sizeMl);
  return (
    <div className={`wine-row${finished ? ' is-finished' : ''}`}>
      <Link className="wine-row-main" to={`/wine/${row.vintage.id}`}>
        {showTitle && (
          <span className="wr-title">
            {row.producer.name} <span className="wr-sep">·</span> {row.bottling.name}
          </span>
        )}
        <span className="wr-line">
          <span className="wr-vintage">{formatYear(row.vintage.year)}</span>
          {badge && <span className="chip">{badge}</span>}
          {finished ? <span className="badge st-finished">Finished</span> : <StatusBadge status={row.status} short />}
          <span className="wr-window">
            {formatWindow(w)}
            {row.vintage.windowSource === 'estimate' && <abbr title="Estimated from a rule of thumb, not tasting notes"> est.</abbr>}
          </span>
          {detail && <span className="wr-detail">{detail}</span>}
        </span>
      </Link>
      <div className="wr-side">
        <span className="wr-count" aria-label={pluralize(row.bottles, 'bottle')}>
          <b>{row.bottles}</b>
          <small>{row.bottles === 1 ? 'bottle' : 'bottles'}</small>
        </span>
        {row.avgPrice !== null && <span className="wr-price">{formatMoney(row.avgPrice, currency)}</span>}
        {!finished && (
          <button className="btn btn-quiet btn-sm" onClick={() => onDrink(row)} aria-label={`Take a bottle out of ${wineTitle(row)}`}>
            <Icon name="cellar" size={16} /> Drink
          </button>
        )}
      </div>
    </div>
  );
}
