import { useMemo, useState } from 'react';
import { addConsumption, addCustomImpression, deleteConsumption, updateConsumption, type FieldErrors } from '../domain/actions';
import { IMPRESSION_CATEGORIES, customImpressionId, impressionLabel, isCustomImpression } from '../domain/impressions';
import { wineTitle, type WineRow } from '../domain/inventory';
import { RATING_MAX, RATING_MIN, RATING_STEP, REMOVAL_REASONS, REMOVAL_REASON_LABEL, type Consumption, type RemovalReason } from '../domain/types';
import { normalizeText, pluralize, toIsoDate } from '../domain/text';
import { useCellar } from '../storage/store';
import { DateField, Field, Stepper } from './forms';
import { Icon } from './Icon';
import { Modal, useToast } from './overlays';

// ---- rating ----------------------------------------------------------------------

/** Your score from 1 to 20 in half points. Unrated until you set one. */
export function RatingInput({ value, onChange, error }: { value: number | undefined; onChange: (v: number | undefined) => void; error?: string }) {
  if (value === undefined) {
    return (
      <div className="rating">
        <button type="button" className="btn btn-sm" onClick={() => onChange(16)}>
          <Icon name="star" size={16} /> Rate it (1–{RATING_MAX})
        </button>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="rating">
      <div className="rating-row">
        <output className="rating-value" aria-live="polite">
          {value % 1 ? value.toFixed(1) : value}
          <small> / {RATING_MAX}</small>
        </output>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(undefined)}>
          Clear
        </button>
      </div>
      <input type="range" min={RATING_MIN} max={RATING_MAX} step={RATING_STEP} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`Rating out of ${RATING_MAX}`} />
      <div className="rating-scale" aria-hidden="true">
        <span>{RATING_MIN}</span>
        <span>{RATING_MAX}</span>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// ---- impressions -----------------------------------------------------------------------

export function ImpressionChips({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <ul className="tags-list">
      {ids.map((id) => (
        <li key={id} className={`word${isCustomImpression(id) ? ' word-custom' : ''}`}>
          {impressionLabel(id)}
        </li>
      ))}
    </ul>
  );
}

/** Tap words from the tasting table, search them, or add your own. */
export function ImpressionPicker({ value, onChange, custom, onAddCustom }: { value: string[]; onChange: (v: string[]) => void; custom: string[]; onAddCustom: (label: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['fruit']));
  const [draft, setDraft] = useState('');
  const picked = new Set(value);
  const q = normalizeText(query);

  const toggle = (id: string) => onChange(picked.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  const categories = useMemo(
    () => [
      ...IMPRESSION_CATEGORIES.map((c) => ({ id: c.id, label: c.label, items: c.items })),
      ...(custom.length ? [{ id: 'custom', label: 'Your words', items: custom.map((label) => ({ id: customImpressionId(label), label })) }] : []),
    ],
    [custom],
  );

  const addDraft = () => {
    const label = draft.trim().slice(0, 60);
    if (!label) return;
    const id = customImpressionId(label);
    onAddCustom(label);
    if (!picked.has(id)) onChange([...value, id]);
    setDraft('');
  };

  return (
    <div className="impressions">
      {value.length > 0 && (
        <ul className="tags-list selected" aria-label="Chosen words">
          {value.map((id) => (
            <li key={id}>
              <button type="button" className="word is-on" onClick={() => toggle(id)} aria-label={`Remove ${impressionLabel(id)}`}>
                {impressionLabel(id)} <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="search search-sm">
        <Icon name="search" size={16} />
        <span className="sr-only">Search tasting words</span>
        <input type="search" placeholder="Search words…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {categories.map((c) => {
        const items = q ? c.items.filter((i) => normalizeText(i.label).includes(q)) : c.items;
        if (q && !items.length) return null;
        const expanded = q ? true : open.has(c.id);
        return (
          <div key={c.id} className="word-group">
            <button
              type="button"
              className="word-group-head"
              aria-expanded={expanded}
              onClick={() =>
                setOpen((o) => {
                  const next = new Set(o);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
            >
              <Icon name="chevron" size={16} />
              {c.label}
              <span className="muted">{c.items.filter((i) => picked.has(i.id)).length || ''}</span>
            </button>
            {expanded && (
              <ul className="tags-list">
                {items.map((i) => (
                  <li key={i.id}>
                    <button type="button" className={`word${picked.has(i.id) ? ' is-on' : ''}`} aria-pressed={picked.has(i.id)} onClick={() => toggle(i.id)}>
                      {i.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="add-word">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Not in the list? Add your own word…"
          aria-label="Add your own tasting word"
          maxLength={60}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button type="button" className="btn btn-sm" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

/** Rating, tasting words and a free note: the "impressions after drinking". */
export function TastingFields({
  rating,
  setRating,
  impressions,
  setImpressions,
  notes,
  setNotes,
  errors,
  showScore = true,
}: {
  rating: number | undefined;
  setRating: (v: number | undefined) => void;
  impressions: string[];
  setImpressions: (v: string[]) => void;
  notes: string;
  setNotes: (v: string) => void;
  errors: FieldErrors;
  showScore?: boolean;
}) {
  const { data, apply } = useCellar();
  return (
    <>
      {showScore && (
        <>
          <Field label="Your rating" className="span-2" error={undefined}>
            {() => <RatingInput value={rating} onChange={setRating} error={errors.rating} />}
          </Field>
          <Field label="Impressions" className="span-2" hint="Tap the words that fit. Everything is optional.">
            {() => (
              <ImpressionPicker
                value={impressions}
                onChange={setImpressions}
                custom={data.settings.customImpressions}
                onAddCustom={(label) => apply((d) => ({ ok: true as const, data: addCustomImpression(d, label) }))}
              />
            )}
          </Field>
        </>
      )}
      <Field label="Notes (optional)" className="span-2">
        {(id) => <textarea id={id} rows={3} value={notes} placeholder="Occasion, company, how it tasted…" onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </>
  );
}

// ---- taking bottles out -----------------------------------------------------------------

/** Takes bottles out of the cellar (drinking, giving away, selling), with tasting notes, and handles undo through a toast. */
export function ConsumeDialog({ row, onClose, presetLocationId }: { row: WineRow; onClose: () => void; presetLocationId?: string }) {
  const { apply } = useCellar();
  const toast = useToast();
  const sources = row.placements;
  const initialSource = presetLocationId && sources.some((s) => s.location.id === presetLocationId) ? presetLocationId : (sources[0]?.location.id ?? '');
  const [source, setSource] = useState(initialSource);
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [reason, setReason] = useState<RemovalReason>('drunk');
  const [rating, setRating] = useState<number | undefined>();
  const [impressions, setImpressions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const fromPlace = sources.find((s) => s.location.id === source);
  const max = source === '' ? (sources.length ? Math.max(1, row.unplaced) : row.bottles) : (fromPlace?.quantity ?? row.bottles);
  const q = Number.isFinite(quantity) ? Math.min(Math.max(1, quantity), max) : 1;

  const submit = () => {
    const drunk = reason === 'drunk';
    const r = apply((d) => addConsumption(d, row.vintage.id, { date, quantity: q, reason, locationId: source || undefined, notes, rating: drunk ? rating : undefined, impressions: drunk ? impressions : undefined }));
    if (!r.ok) {
      setErrors(r.fieldErrors ?? { quantity: r.error });
      return;
    }
    const left = row.bottles - q;
    const verb = reason === 'drunk' ? 'Enjoyed' : reason === 'sold' ? 'Sold' : reason === 'gifted' ? 'Gave away' : 'Removed';
    toast(`${verb} ${pluralize(q, 'bottle')} of ${wineTitle(row)} · ${left} left`, {
      action: { label: 'Undo', onClick: () => apply((d) => ({ ok: true as const, data: deleteConsumption(d, r.consumptionId) })) },
    });
    onClose();
  };

  return (
    <Modal
      title="Take bottles out"
      onClose={onClose}
      wide
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
        {sources.length > 0 && (
          <Field label="Taken from" error={errors.locationId} className="span-2">
            {(id, d) => (
              <select id={id} value={source} onChange={(e) => setSource(e.target.value)} aria-describedby={d}>
                {sources.map((s) => (
                  <option key={s.location.id} value={s.location.id}>
                    {s.location.name} — {pluralize(s.quantity, 'bottle')}
                  </option>
                ))}
                {row.unplaced > 0 && <option value="">No place recorded — {pluralize(row.unplaced, 'bottle')}</option>}
              </select>
            )}
          </Field>
        )}
        <Field label="How many?" error={errors.quantity}>
          {(id, d) => <Stepper id={id} describedBy={d} label="Bottles" value={q} min={1} max={max} onChange={setQuantity} />}
        </Field>
        <Field label="Date" error={errors.date}>
          {(id, d) => <DateField id={id} value={date} onChange={setDate} describedBy={d} />}
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
        <TastingFields rating={rating} setRating={setRating} impressions={impressions} setImpressions={setImpressions} notes={notes} setNotes={setNotes} errors={errors} showScore={reason === 'drunk'} />
      </div>
    </Modal>
  );
}

/** Adds to, or corrects, the tasting notes of something already taken out. */
export function TastingDialog({ consumption, title, onClose }: { consumption: Consumption; title: string; onClose: () => void }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [date, setDate] = useState(consumption.date);
  const [reason, setReason] = useState<RemovalReason>(consumption.reason);
  const [rating, setRating] = useState<number | undefined>(consumption.rating);
  const [impressions, setImpressions] = useState<string[]>(consumption.impressions ?? []);
  const [notes, setNotes] = useState(consumption.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const r = apply((d) => updateConsumption(d, consumption.id, { date, reason, notes, rating, impressions }));
    if (!r.ok) {
      setErrors(r.fieldErrors ?? { date: r.error });
      return;
    }
    toast('Tasting notes saved');
    onClose();
  };

  return (
    <Modal
      title="Tasting notes"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <p className="modal-text">
        <strong>{title}</strong>
        <br />
        {pluralize(consumption.quantity, 'bottle')}
      </p>
      <div className="form-grid">
        <Field label="Date" error={errors.date}>
          {(id, d) => <DateField id={id} value={date} onChange={setDate} describedBy={d} />}
        </Field>
        <Field label="What happened?">
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
        <TastingFields rating={rating} setRating={setRating} impressions={impressions} setImpressions={setImpressions} notes={notes} setNotes={setNotes} errors={errors} />
      </div>
    </Modal>
  );
}
