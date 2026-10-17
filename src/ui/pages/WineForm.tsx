import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addWine, findBottling, findProducer, findVintage, updateWine, type FieldErrors, type PurchaseInput, type WineInput } from '../../domain/actions';
import { stockOf } from '../../domain/inventory';
import { parseNumber } from '../../domain/portability';
import { COMMON_COUNTRIES, COMMON_GRAPES } from '../../domain/reference';
import { BOTTLE_SIZES, WINE_TYPES, WINE_TYPE_LABEL, type WindowSource, type WineType } from '../../domain/types';
import { compareText, formatYear, normalizeText, pluralize, toIsoDate } from '../../domain/text';
import { STATUS_LABEL, WINDOW_PRESETS, presetWindow, validateWindow, windowStatus, type DrinkWindow } from '../../domain/window';
import { useCellar, useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, DateField, EmptyNote, Field, PageHead } from '../components';
import { useToast } from '../overlays';
import { StatusBadge, WindowTrack, domainFor, yearPosition } from '../status';

interface FormState {
  producer: string;
  bottling: string;
  type: WineType;
  country: string;
  region: string;
  appellation: string;
  grapes: { grape: string; percent: string }[];
  nv: boolean;
  year: string;
  sizeMl: string;
  drinkFrom: string;
  drinkTo: string;
  peakFrom: string;
  peakTo: string;
  windowSource: WindowSource | undefined;
  location: string;
  notes: string;
  qty: string;
  price: string;
  date: string;
  merchant: string;
}

const emptyForm = (): FormState => ({
  producer: '',
  bottling: '',
  type: 'red',
  country: '',
  region: '',
  appellation: '',
  grapes: [],
  nv: false,
  year: '',
  sizeMl: '750',
  drinkFrom: '',
  drinkTo: '',
  peakFrom: '',
  peakTo: '',
  windowSource: undefined,
  location: '',
  notes: '',
  qty: '1',
  price: '',
  date: toIsoDate(new Date()),
  merchant: '',
});

const yearOrUndefined = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));

function toWineInput(f: FormState): WineInput {
  return {
    producer: f.producer,
    bottling: f.bottling,
    type: f.type,
    country: f.country,
    region: f.region,
    appellation: f.appellation,
    grapes: f.grapes
      .filter((g) => g.grape.trim() !== '' || g.percent.trim() !== '')
      .map((g) => ({ grape: g.grape, percent: g.percent.trim() === '' ? undefined : (parseNumber(g.percent) ?? Number.NaN) })),
    year: f.nv ? null : f.year.trim() === '' ? Number.NaN : Number(f.year),
    sizeMl: Number(f.sizeMl),
    drinkFrom: yearOrUndefined(f.drinkFrom),
    drinkTo: yearOrUndefined(f.drinkTo),
    peakFrom: yearOrUndefined(f.peakFrom),
    peakTo: yearOrUndefined(f.peakTo),
    windowSource: f.windowSource,
    location: f.location,
    notes: f.notes,
  };
}

function toPurchase(f: FormState): PurchaseInput | undefined {
  const q = f.qty.trim() === '' ? 0 : Number(f.qty);
  if (q === 0) return undefined;
  return {
    quantity: q,
    unitPrice: f.price.trim() === '' ? undefined : (parseNumber(f.price) ?? Number.NaN),
    date: f.date.trim() === '' ? undefined : f.date.trim(),
    merchant: f.merchant,
  };
}

const unique = (xs: (string | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))].sort(compareText);

/** The `key` resets the form when you go from editing one wine straight to another. */
export function WineForm() {
  const { id } = useParams();
  return <WineFormInner key={id ?? 'new'} />;
}

function WineFormInner() {
  const { id } = useParams();
  const editing = id !== undefined;
  const { data, rows, now } = useRows();
  const { apply } = useCellar();
  const toast = useToast();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  const row = editing ? rows.find((r) => r.vintage.id === id) : undefined;
  const [form, setForm] = useState<FormState>(() => {
    if (!row) return emptyForm();
    const { vintage: v, bottling: b, producer: p } = row;
    return {
      ...emptyForm(),
      producer: p.name,
      bottling: b.name,
      type: b.type,
      country: b.country ?? '',
      region: b.region ?? '',
      appellation: b.appellation ?? '',
      grapes: b.grapes.map((g) => ({ grape: g.grape, percent: g.percent === undefined ? '' : String(g.percent) })),
      nv: v.year === null,
      year: v.year === null ? '' : String(v.year),
      sizeMl: String(v.sizeMl),
      drinkFrom: v.drinkFrom === undefined ? '' : String(v.drinkFrom),
      drinkTo: v.drinkTo === undefined ? '' : String(v.drinkTo),
      peakFrom: v.peakFrom === undefined ? '' : String(v.peakFrom),
      peakTo: v.peakTo === undefined ? '' : String(v.peakTo),
      windowSource: v.windowSource,
      location: v.location ?? '',
      notes: v.notes ?? '',
    };
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [presetNote, setPresetNote] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // ---- matching against what is already in the cellar ----
  const matchedProducer = useMemo(() => (form.producer.trim() ? findProducer(data, form.producer) : undefined), [data, form.producer]);
  const matchedBottling = useMemo(() => (matchedProducer && form.bottling.trim() ? findBottling(data, matchedProducer.id, form.bottling) : undefined), [data, matchedProducer, form.bottling]);
  const ownBottlingId = row?.bottling.id;

  // When the typed producer + bottling is a bottling we already know, fill in the blanks from it.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!matchedBottling || matchedBottling.id === ownBottlingId || filledFor.current === matchedBottling.id) return;
    filledFor.current = matchedBottling.id;
    setForm((f) => ({
      ...f,
      type: matchedBottling.type,
      country: f.country || matchedBottling.country || '',
      region: f.region || matchedBottling.region || '',
      appellation: f.appellation || matchedBottling.appellation || '',
      grapes: f.grapes.length ? f.grapes : matchedBottling.grapes.map((g) => ({ grape: g.grape, percent: g.percent === undefined ? '' : String(g.percent) })),
    }));
  }, [matchedBottling, ownBottlingId]);

  /** `null` = non-vintage, `undefined` = no usable year typed yet. */
  const yearParsed: number | null | undefined = form.nv ? null : /^\d{4}$/.test(form.year.trim()) ? Number(form.year) : undefined;
  const existingVintage = !editing && matchedBottling && yearParsed !== undefined ? findVintage(data, matchedBottling.id, yearParsed, Number(form.sizeMl)) : undefined;
  const existingStock = existingVintage ? stockOf(data, existingVintage.id) : 0;
  const movesVintage =
    editing &&
    row !== undefined &&
    form.producer.trim() !== '' &&
    form.bottling.trim() !== '' &&
    (normalizeText(form.producer) !== normalizeText(row.producer.name) || normalizeText(form.bottling) !== normalizeText(row.bottling.name));

  const bottlingsOfProducer = matchedProducer ? data.bottlings.filter((b) => b.producerId === matchedProducer.id).map((b) => b.name) : [];
  const grapeOptions = unique([...COMMON_GRAPES, ...data.bottlings.flatMap((b) => b.grapes.map((g) => g.grape))]);
  const countryOptions = unique([...COMMON_COUNTRIES, ...data.bottlings.map((b) => b.country)]);

  // ---- drinking window ----
  const window: DrinkWindow = { drinkFrom: yearOrUndefined(form.drinkFrom), drinkTo: yearOrUndefined(form.drinkTo), peakFrom: yearOrUndefined(form.peakFrom), peakTo: yearOrUndefined(form.peakTo) };
  const windowValid = Object.keys(validateWindow(window)).length === 0;
  const windowHasValues = Object.values(window).some((v) => v !== undefined);
  const nowYear = now.getFullYear();
  const baseYear = yearParsed === null ? nowYear : yearParsed;

  const setWindowField = (key: 'drinkFrom' | 'drinkTo' | 'peakFrom' | 'peakTo', value: string) => setForm((f) => ({ ...f, [key]: value, windowSource: 'manual' }));
  const applyPreset = (presetId: string) => {
    const preset = WINDOW_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (baseYear === undefined) {
      setPresetNote('Enter the vintage first — the estimate counts from the year it was made.');
      return;
    }
    const w = presetWindow(preset, baseYear);
    setPresetNote(form.nv ? 'Counted from this year, since the wine is non-vintage.' : null);
    setForm((f) => ({ ...f, drinkFrom: String(w.drinkFrom), drinkTo: String(w.drinkTo), peakFrom: String(w.peakFrom), peakTo: String(w.peakTo), windowSource: 'estimate' }));
  };
  const clearWindow = () => {
    setPresetNote(null);
    setForm((f) => ({ ...f, drinkFrom: '', drinkTo: '', peakFrom: '', peakTo: '', windowSource: undefined }));
  };

  // ---- submit ----
  const showErrors = (fieldErrors: FieldErrors | undefined, message: string) => {
    const fe = fieldErrors ?? {};
    setErrors(Object.keys(fe).length ? fe : { form: message });
    requestAnimationFrame(() => {
      const names = Object.keys(fe);
      const el = [...(formRef.current?.querySelectorAll<HTMLElement>('[name]') ?? [])].find((n) => names.includes(n.getAttribute('name') ?? ''));
      el?.focus();
      if (!el) formRef.current?.querySelector('.form-error')?.scrollIntoView({ block: 'center' });
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = toWineInput(form);
    const purchase = editing ? undefined : toPurchase(form);
    const localErrors: FieldErrors = {};
    if (input.grapes.some((g) => g.grape.trim() === '')) localErrors.grapes = 'Add a grape name for every percentage';
    if (purchase?.date !== undefined && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(purchase.date)) localErrors['purchase.date'] = 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)';
    if (Object.keys(localErrors).length) {
      showErrors(localErrors, 'Please fix the highlighted fields');
      return;
    }

    if (editing) {
      const r = apply((d) => updateWine(d, id as string, input, now));
      if (!r.ok) return showErrors(r.fieldErrors, r.error);
      toast('Saved');
      navigate(`/wine/${id}`, { replace: true });
      return;
    }
    const r = apply((d) => addWine(d, input, purchase, now));
    if (!r.ok) return showErrors(r.fieldErrors, r.error);
    toast(r.merged ? 'Already in your cellar — bottles added to it' : 'Wine added');
    navigate(`/wine/${r.vintageId}`, { replace: true });
  };

  if (editing && !row) {
    return (
      <>
        <PageHead title="Wine not found" />
        <Card>
          <EmptyNote>
            This wine isn’t in your cellar. <Link to="/cellar">Back to the cellar</Link>
          </EmptyNote>
        </Card>
      </>
    );
  }

  const liveStatus = windowHasValues && windowValid ? windowStatus(window, nowYear, data.settings.drinkSoonYears) : null;
  const err = (k: string) => errors[k];

  return (
    <>
      <Link className="back-link" to={editing ? `/wine/${id}` : '/cellar'}>
        <Icon name="back" size={18} /> {editing ? 'Back to wine' : 'Cellar'}
      </Link>
      <PageHead title={editing ? 'Edit wine' : 'Add a wine'} subtitle={editing ? undefined : 'Start with the producer and bottling — anything you’ve entered before is filled in for you.'} />

      <form ref={formRef} onSubmit={submit} noValidate className="wine-form">
        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}

        <Card title="The wine">
          <div className="form-grid">
            <Field label="Producer" error={err('producer')} className="span-2">
              {(id, d) => (
                <input id={id} name="producer" list="dl-producers" value={form.producer} onChange={(e) => set('producer', e.target.value)} placeholder="e.g. Château Margaux" autoCapitalize="words" autoComplete="off" aria-describedby={d} aria-invalid={!!err('producer')} />
              )}
            </Field>
            <Field
              label="Bottling / cuvée"
              error={err('bottling')}
              hint="The wine’s label name, e.g. “Grand Vin”, “Barolo Cannubi” or “Estate”."
              className="span-2"
            >
              {(id, d) => (
                <input id={id} name="bottling" list="dl-bottlings" value={form.bottling} onChange={(e) => set('bottling', e.target.value)} placeholder="e.g. Grand Vin" autoCapitalize="words" autoComplete="off" aria-describedby={d} aria-invalid={!!err('bottling')} />
              )}
            </Field>
            {matchedBottling && matchedBottling.id !== ownBottlingId && (
              <p className="notice span-2">
                <Icon name="check" size={16} /> You already have this bottling — its type, origin and varieties are filled in.
              </p>
            )}
            {movesVintage && (
              <p className="notice span-2">
                <Icon name="info" size={16} /> Changing the producer or bottling name moves just this vintage to that bottling.
              </p>
            )}
            <Field label="Type" error={err('type')} className="span-2">
              {(id) => (
                <div id={id} className="seg seg-wrap" role="group" aria-label="Type">
                  {WINE_TYPES.map((t) => (
                    <button key={t} type="button" aria-pressed={form.type === t} className={form.type === t ? 'is-active' : undefined} onClick={() => set('type', t)}>
                      {WINE_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </Card>

        <Card title="Origin and varieties" subtitle={editing ? 'Shared by every vintage of this bottling.' : undefined}>
          <div className="form-grid">
            <Field label="Country">
              {(id) => <input id={id} name="country" list="dl-countries" value={form.country} onChange={(e) => set('country', e.target.value)} autoCapitalize="words" autoComplete="off" />}
            </Field>
            <Field label="Region">
              {(id) => <input id={id} name="region" list="dl-regions" value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="e.g. Bordeaux" autoCapitalize="words" autoComplete="off" />}
            </Field>
            <Field label="Appellation" className="span-2">
              {(id) => <input id={id} name="appellation" list="dl-appellations" value={form.appellation} onChange={(e) => set('appellation', e.target.value)} placeholder="e.g. Saint-Émilion Grand Cru" autoCapitalize="words" autoComplete="off" />}
            </Field>
          </div>
          <fieldset className="grapes" aria-describedby={err('grapes') ? 'grapes-error' : undefined}>
            <legend>Grape varieties</legend>
            {form.grapes.length === 0 && <p className="field-hint">Add the varieties in the blend, with percentages if you know them.</p>}
            {form.grapes.map((g, i) => (
              <div className="grape-row" key={i}>
                <input
                  aria-label={`Grape ${i + 1}`}
                  name={i === 0 ? 'grapes' : undefined}
                  list="dl-grapes"
                  value={g.grape}
                  placeholder="Variety"
                  autoComplete="off"
                  onChange={(e) => setForm((f) => ({ ...f, grapes: f.grapes.map((x, j) => (j === i ? { ...x, grape: e.target.value } : x)) }))}
                />
                <span className="pct-input">
                  <input
                    aria-label={`Percentage for grape ${i + 1}`}
                    inputMode="decimal"
                    value={g.percent}
                    placeholder="%"
                    onChange={(e) => setForm((f) => ({ ...f, grapes: f.grapes.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)) }))}
                  />
                </span>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove grape ${i + 1}`} onClick={() => setForm((f) => ({ ...f, grapes: f.grapes.filter((_, j) => j !== i) }))}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            ))}
            {err('grapes') && (
              <p id="grapes-error" className="field-error">
                {err('grapes')}
              </p>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, grapes: [...f.grapes, { grape: '', percent: '' }] }))}>
              <Icon name="plus" size={16} /> Add a variety
            </button>
          </fieldset>
        </Card>

        <Card title="Vintage and size">
          <div className="form-grid">
            <Field label="Vintage" error={err('year')}>
              {(id, d) => (
                <input id={id} name="year" inputMode="numeric" value={form.nv ? '' : form.year} disabled={form.nv} onChange={(e) => set('year', e.target.value)} placeholder={form.nv ? 'Non-vintage' : 'e.g. 2018'} maxLength={4} aria-describedby={d} aria-invalid={!!err('year')} />
              )}
            </Field>
            <Field label="Bottle size" error={err('sizeMl')}>
              {(id) => (
                <select id={id} name="sizeMl" value={form.sizeMl} onChange={(e) => set('sizeMl', e.target.value)}>
                  {!BOTTLE_SIZES.some((s) => String(s.ml) === form.sizeMl) && <option value={form.sizeMl}>{form.sizeMl} ml</option>}
                  {BOTTLE_SIZES.map((s) => (
                    <option key={s.ml} value={s.ml}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <label className="check span-2">
              <input type="checkbox" checked={form.nv} onChange={(e) => set('nv', e.target.checked)} />
              Non-vintage (NV) — no single year on the label
            </label>
            {existingVintage && (
              <p className="notice notice-info span-2">
                <Icon name="info" size={16} /> You already have <strong>{formatYear(existingVintage.year)}</strong> of this wine ({pluralize(existingStock, 'bottle')}). Saving adds these bottles to it instead of creating a duplicate.{' '}
                <Link to={`/wine/${existingVintage.id}`}>Open it</Link>
              </p>
            )}
          </div>
        </Card>

        <Card title="Drinking window" className="window-card">
          <div id="window" className="anchor" />
          <p className="card-sub">The years this vintage is good to drink, both ends inclusive. Use your own tasting notes or a critic’s guidance if you have them — or start from an estimate.</p>
          <div className="presets" role="group" aria-label="Estimate from aging potential">
            {WINDOW_PRESETS.map((p) => (
              <button type="button" key={p.id} className="preset" onClick={() => applyPreset(p.id)}>
                <strong>{p.label}</strong>
                <span>{p.hint}</span>
                <span className="preset-range">
                  {p.from}–{p.to} yrs after vintage
                </span>
              </button>
            ))}
          </div>
          {presetNote && <p className="notice span-2">{presetNote}</p>}
          <div className="form-grid form-grid-4">
            <Field label="Drink from" error={err('drinkFrom')}>
              {(id, d) => <input id={id} name="drinkFrom" inputMode="numeric" maxLength={4} value={form.drinkFrom} onChange={(e) => setWindowField('drinkFrom', e.target.value)} placeholder="Year" aria-describedby={d} aria-invalid={!!err('drinkFrom')} />}
            </Field>
            <Field label="Drink until" error={err('drinkTo')}>
              {(id, d) => <input id={id} name="drinkTo" inputMode="numeric" maxLength={4} value={form.drinkTo} onChange={(e) => setWindowField('drinkTo', e.target.value)} placeholder="Year" aria-describedby={d} aria-invalid={!!err('drinkTo')} />}
            </Field>
            <Field label="Peak from (optional)" error={err('peakFrom')}>
              {(id, d) => <input id={id} name="peakFrom" inputMode="numeric" maxLength={4} value={form.peakFrom} onChange={(e) => setWindowField('peakFrom', e.target.value)} placeholder="Year" aria-describedby={d} aria-invalid={!!err('peakFrom')} />}
            </Field>
            <Field label="Peak until (optional)" error={err('peakTo')}>
              {(id, d) => <input id={id} name="peakTo" inputMode="numeric" maxLength={4} value={form.peakTo} onChange={(e) => setWindowField('peakTo', e.target.value)} placeholder="Year" aria-describedby={d} aria-invalid={!!err('peakTo')} />}
            </Field>
          </div>
          {windowHasValues && windowValid && (
            <div className="window-preview">
              <WindowTrack window={window} status={liveStatus ?? 'unknown'} domain={domainFor(window, yearPosition(now))} nowPos={yearPosition(now)} />
              <p className="window-note">
                {liveStatus && (
                  <>
                    Today this wine is <strong>{STATUS_LABEL[liveStatus].toLowerCase()}</strong> <StatusBadge status={liveStatus} short />.{' '}
                  </>
                )}
                {form.windowSource === 'estimate' && 'This is a rule-of-thumb estimate and will be marked “est.” until you change a year.'}
              </p>
            </div>
          )}
          {windowHasValues && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={clearWindow}>
              Clear the window
            </button>
          )}
        </Card>

        {!editing && (
          <Card title="Bottles you’re adding" subtitle="Leave the number at 0 to record the wine without any bottles.">
            <div className="form-grid">
              <Field label="Bottles" error={err('purchase.quantity')}>
                {(id, d) => <input id={id} name="purchase.quantity" inputMode="numeric" value={form.qty} onChange={(e) => set('qty', e.target.value)} aria-describedby={d} aria-invalid={!!err('purchase.quantity')} />}
              </Field>
              <Field label={`Price per bottle (${data.settings.currency})`} error={err('purchase.unitPrice')} hint="Leave empty if you don’t know">
                {(id, d) => <input id={id} name="purchase.unitPrice" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" aria-describedby={d} aria-invalid={!!err('purchase.unitPrice')} />}
              </Field>
              <Field label="Date bought" error={err('purchase.date')}>
                {(id, d) => <DateField id={id} name="purchase.date" value={form.date} onChange={(v) => set('date', v)} describedBy={d} />}
              </Field>
              <Field label="Bought from">
                {(id) => <input id={id} name="merchant" value={form.merchant} onChange={(e) => set('merchant', e.target.value)} placeholder="Merchant, shop, auction, gift…" autoCapitalize="words" />}
              </Field>
            </div>
          </Card>
        )}

        <Card title="Storage and notes">
          <div className="form-grid">
            <Field label="Where it’s stored" className="span-2">
              {(id) => <input id={id} name="location" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Cellar, rack 3" />}
            </Field>
            <Field label="Notes" className="span-2">
              {(id) => <textarea id={id} name="notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering about this vintage" />}
            </Field>
          </div>
        </Card>

        <div className="form-actions">
          <Link className="btn" to={editing ? `/wine/${id}` : '/cellar'}>
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary">
            {editing ? 'Save changes' : existingVintage ? 'Add bottles' : 'Add to cellar'}
          </button>
        </div>
      </form>

      <datalist id="dl-producers">
        {data.producers.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="dl-bottlings">
        {bottlingsOfProducer.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="dl-countries">
        {countryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="dl-regions">
        {unique(data.bottlings.map((b) => b.region)).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="dl-appellations">
        {unique(data.bottlings.map((b) => b.appellation)).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="dl-grapes">
        {grapeOptions.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </>
  );
}
