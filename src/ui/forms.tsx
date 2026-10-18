import { useId, useState, type ReactNode } from 'react';

/** A labelled field. `children` receives the id and the `aria-describedby` to put on the control. */
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

export function Stepper({
  id,
  describedBy,
  value,
  min = 1,
  max,
  onChange,
  label,
  name,
}: {
  id?: string;
  describedBy?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  label: string;
  name?: string;
}) {
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="btn btn-icon" onClick={() => onChange(clamp((Number.isFinite(value) ? value : min) - 1))} disabled={value <= min} aria-label="One fewer">
        −
      </button>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Math.round(Number(e.target.value)))}
        onBlur={() => onChange(Number.isFinite(value) ? clamp(value) : min)}
        aria-describedby={describedBy}
      />
      <button type="button" className="btn btn-icon" onClick={() => onChange(clamp((Number.isFinite(value) ? value : min) + 1))} disabled={max !== undefined && value >= max} aria-label="One more">
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

export type { ReactNode };
