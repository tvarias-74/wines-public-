import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  addWine,
  findBottling,
  findProducer,
  findVintage,
  referencedImageIds,
  updateWine,
  validatePurchaseInput,
  validateWineInput,
  type FieldErrors,
  type PlacementInput,
  type PurchaseInput,
  type WineInput,
} from '../../domain/actions';
import { stockOf } from '../../domain/inventory';
import { parseNumber } from '../../domain/portability';
import { COMMON_COUNTRIES, COMMON_GRAPES } from '../../domain/reference';
import { BOTTLE_SIZES, COLOURS, COLOUR_LABEL, WINE_STYLES, WINE_STYLE_LABEL, type Colour, type VintageImages, type WindowSource, type WineStyle } from '../../domain/types';
import { compareText, formatYear, normalizeText, pluralize, toIsoDate } from '../../domain/text';
import { formatWindow, STATUS_LABEL, WINDOW_PRESETS, presetWindow, validateWindow, windowStatus, type DrinkWindow } from '../../domain/window';
import { useCellar, useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, DateField, EmptyNote, Field, PageHead } from '../components';
import { PhotoSlot, discardImage } from '../LabelImage';
import { useConfirm, useToast } from '../overlays';
import { PlacementPicker } from '../Placement';
import { StatusBadge, WindowTrack, domainFor, yearPosition } from '../status';

type ColourChoice = Colour | 'unknown' | '';

interface FormState {
  producer: string;
  group: string;
  bottling: string;
  colour: ColourChoice;
  sparkling: boolean;
  style: WineStyle | '';
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
  notes: string;
  images: VintageImages;
  qty: string;
  price: string;
  date: string;
  merchant: string;
}

const emptyForm = (): FormState => ({
  producer: '',
  group: '',
  bottling: '',
  colour: '',
  sparkling: false,
  style: '',
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
  notes: '',
  images: {},
  qty: '1',
  price: '',
  date: toIsoDate(new Date()),
  merchant: '',
});

const yearOrUndefined = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));
const grapeRows = (g: { grape: string; percent?: number }[]) => g.map((x) => ({ grape: x.grape, percent: x.percent === undefined ? '' : String(x.percent) }));

function toWineInput(f: FormState): WineInput {
  return {
    producer: f.producer,
    group: f.group,
    bottling: f.bottling,
    colour: f.colour === '' || f.colour === 'unknown' ? undefined : f.colour,
    sparkling: f.sparkling,
    style: f.style === '' ? undefined : f.style,
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
    notes: f.notes,
    images: f.images,
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
    const { vintage: v, bottling: b, producer: p, group } = row;
    return {
      ...emptyForm(),
      producer: p.name,
      group: group?.name ?? '',
      bottling: b.name,
      colour: b.colour ?? 'unknown',
      sparkling: b.sparkling,
      style: b.style ?? '',
      country: b.country ?? '',
      region: b.region ?? '',
      appellation: b.appellation ?? '',
      grapes: grapeRows(b.grapes),
      nv: v.year === null,
      year: v.year === null ? '' : String(v.year),
      sizeMl: String(v.sizeMl),
      drinkFrom: v.drinkFrom === undefined ? '' : String(v.drinkFrom),
      drinkTo: v.drinkTo === undefined ? '' : String(v.drinkTo),
      peakFrom: v.peakFrom === undefined ? '' : String(v.peakFrom),
      peakTo: v.peakTo === undefined ? '' : String(v.peakTo),
      windowSource: v.windowSource,
      notes: v.notes ?? '',
      images: { ...v.images },
    };
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlacementInput[]>([]);
  const [planProblem, setPlanProblem] = useState<string | null>(null);

  // Photos captured in this form are on the device already; if the form is abandoned, they are thrown away.
  const sessionPhotos = useRef(new Set<string>());
  const saved = useRef(false);

  // Leaving a half-filled form (tab bar, back gesture, Cancel, closing the tab) asks first.
  const confirm = useConfirm();
  const initialForm = useRef<string | null>(null);
  if (initialForm.current === null) initialForm.current = JSON.stringify(form);
  const dirty = useRef(false);
  dirty.current = JSON.stringify(form) !== initialForm.current;
  const blocker = useBlocker(() => dirty.current && !saved.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const photos = !!(form.images.front || form.images.back) && [form.images.front, form.images.back].some((p) => p && sessionPhotos.current.has(p));
    void confirm({
      title: 'Leave without saving?',
      message: photos ? 'What you have entered here will be lost, including the photos you just took.' : 'What you have entered here will be lost.',
      confirmLabel: 'Leave',
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current && !saved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    // `window` is the drinking window in this component, so the browser's one is reached as globalThis.
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(
    () => () => {
      if (!saved.current) sessionPhotos.current.forEach((p) => void discardImage(p));
    },
    [],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // ---- matching against what is already in the cellar ----
  const matchedProducer = useMemo(() => (form.producer.trim() ? findProducer(data, form.producer) : undefined), [data, form.producer]);
  const matchedBottling = useMemo(() => (matchedProducer && form.bottling.trim() ? findBottling(data, matchedProducer.id, form.bottling) : undefined), [data, matchedProducer, form.bottling]);
  const ownBottlingId = row?.bottling.id;
  /** Details shared by every vintage of a bottling you already have can't be changed from another wine's form. */
  const bottlingLocked = !!matchedBottling && matchedBottling.id !== ownBottlingId;

  // When the typed winery + bottling is one we already know, show exactly what we know about it.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!matchedBottling || matchedBottling.id === ownBottlingId || filledFor.current === matchedBottling.id) return;
    filledFor.current = matchedBottling.id;
    setForm((f) => ({
      ...f,
      colour: matchedBottling.colour ?? 'unknown',
      sparkling: matchedBottling.sparkling,
      style: matchedBottling.style ?? '',
      country: matchedBottling.country ?? '',
      region: matchedBottling.region ?? '',
      appellation: matchedBottling.appellation ?? '',
      grapes: grapeRows(matchedBottling.grapes),
    }));
  }, [matchedBottling, ownBottlingId]);

  // A winery we already know brings its owner family with it.
  const groupFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!matchedProducer || matchedProducer.id === row?.producer.id || groupFilledFor.current === matchedProducer.id) return;
    groupFilledFor.current = matchedProducer.id;
    const g = matchedProducer.groupId ? data.groups.find((x) => x.id === matchedProducer.groupId) : undefined;
    setForm((f) => ({ ...f, group: g?.name ?? f.group }));
  }, [matchedProducer, row?.producer.id, data.groups]);

  /** `null` = non-vintage, `undefined` = no usable year typed yet. */
  const yearParsed: number | null | undefined = form.nv ? null : /^\d{4}$/.test(form.year.trim()) ? Number(form.year) : undefined;
  const existingVintage = !editing && matchedBottling && yearParsed !== undefined ? findVintage(data, matchedBottling.id, yearParsed, Number(form.sizeMl)) : undefined;
  // A side of the label this vintage already has a photo for keeps that photo: a new one taken here would
  // be thrown away on saving, so it is set aside now, with a message, rather than silently later.
  const heldFront = existingVintage?.images?.front;
  const heldBack = existingVintage?.images?.back;
  useEffect(() => {
    const dropped: string[] = [];
    for (const side of ['front', 'back'] as const) {
      const held = side === 'front' ? heldFront : heldBack;
      const mine = form.images[side];
      if (!held || !mine || mine === held) continue;
      if (sessionPhotos.current.has(mine)) {
        sessionPhotos.current.delete(mine);
        void discardImage(mine);
      }
      dropped.push(side);
    }
    if (!dropped.length) return;
    setForm((f) => ({ ...f, images: { ...f.images, ...(dropped.includes('front') ? { front: undefined } : {}), ...(dropped.includes('back') ? { back: undefined } : {}) } }));
    toast(`This vintage already has its ${dropped.join(' and ')} label photo, so the new one was not kept. Replace it from the wine’s page.`, { tone: 'error' });
  }, [heldFront, heldBack, form.images.front, form.images.back]); // eslint-disable-line react-hooks/exhaustive-deps
  const existingStock = existingVintage ? stockOf(data, existingVintage.id) : 0;
  const existingHasWindow = existingVintage ? existingVintage.drinkFrom !== undefined || existingVintage.drinkTo !== undefined : false;
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

  // ---- photos ----
  const setPhoto = (side: 'front' | 'back', newId: string | undefined) => {
    const old = form.images[side];
    if (newId) sessionPhotos.current.add(newId);
    // A replaced photo that was only just taken here can go straight away; one that was saved with the wine is dropped after saving.
    if (old && sessionPhotos.current.has(old)) {
      sessionPhotos.current.delete(old);
      void discardImage(old);
    }
    setForm((f) => ({ ...f, images: { ...f.images, [side]: newId } }));
  };

  // ---- submit ----
  const showErrors = (fieldErrors: FieldErrors | undefined, message: string) => {
    const fe = fieldErrors ?? {};
    setErrors(Object.keys(fe).length ? fe : { form: message });
    requestAnimationFrame(() => {
      const names = Object.keys(fe);
      const el = [...(formRef.current?.querySelectorAll<HTMLElement>('[name]') ?? [])].find((n) => names.includes(n.getAttribute('name') ?? ''));
      el?.focus();
      if (!el) formRef.current?.querySelector('.form-error, .field-error')?.scrollIntoView({ block: 'center' });
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = toWineInput(form);
    const purchase = editing ? undefined : toPurchase(form);
    // Report every problem at once: the form's own checks and the ones the cellar itself makes.
    const localErrors: FieldErrors = { ...validateWineInput(input, now) };
    if (purchase) for (const [k, v] of Object.entries(validatePurchaseInput(purchase))) localErrors[`purchase.${k}`] = v;
    if (form.colour === '') localErrors.colour = 'Choose a colour, or “Not sure”';
    if (input.grapes.some((g) => g.grape.trim() === '')) localErrors.grapes = 'Add a grape name for every percentage';
    if (purchase?.date !== undefined && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(purchase.date)) localErrors['purchase.date'] = 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)';
    if (planProblem && !editing) localErrors.placements = planProblem;
    if (Object.keys(localErrors).length) {
      showErrors(localErrors, 'Please fix the highlighted fields');
      return;
    }

    const finish = (next: Parameters<typeof referencedImageIds>[0]) => {
      saved.current = true;
      const keep = referencedImageIds(next);
      for (const p of sessionPhotos.current) if (!keep.has(p)) void discardImage(p);
      // A photo this wine had before is not deleted here: the photo store clears pictures nobody uses, after a long while.
    };

    if (editing) {
      const r = apply((d) => updateWine(d, id as string, input, now));
      if (!r.ok) return showErrors(r.fieldErrors, r.error);
      finish(r.data);
      toast('Saved');
      navigate(`/wine/${id}`, { replace: true });
      return;
    }
    const r = apply((d) => addWine(d, input, purchase, now, plan));
    if (!r.ok) return showErrors(r.fieldErrors, r.error);
    finish(r.data);
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
  const qtyNumber = form.qty.trim() === '' ? 0 : Number(form.qty);
  const lockedNote = 'Shared by every vintage of this bottling, so it can’t change here. To change it, edit one of its wines.';
  const existingPhotosLocked = !!existingVintage && !!(existingVintage.images?.front || existingVintage.images?.back);

  return (
    <>
      <Link className="back-link" to={editing ? `/wine/${id}` : '/cellar'}>
        <Icon name="back" size={18} /> {editing ? 'Back to wine' : 'Cellar'}
      </Link>
      <PageHead title={editing ? 'Edit wine' : 'Add a wine'} subtitle={editing ? undefined : 'Photograph the label, then give the winery and bottling — anything you’ve entered before is filled in for you.'} />

      <form ref={formRef} onSubmit={submit} noValidate className="wine-form">
        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}

        <Card title="Label photos" subtitle="Front and back of the bottle. They stay on this device and show in your cellar gallery.">
          <div className="photo-pair">
            <PhotoSlot label="Front label" imageId={existingVintage?.images?.front ?? form.images.front} onChange={(i) => setPhoto('front', i)} onError={(m) => toast(m, { tone: 'error' })} disabled={existingPhotosLocked && !!existingVintage?.images?.front} />
            <PhotoSlot label="Back label" imageId={existingVintage?.images?.back ?? form.images.back} onChange={(i) => setPhoto('back', i)} onError={(m) => toast(m, { tone: 'error' })} disabled={existingPhotosLocked && !!existingVintage?.images?.back} />
          </div>
          {existingPhotosLocked && <p className="field-hint">This vintage already has photos; add or replace them from its page.</p>}
        </Card>

        <Card title="The wine">
          <div className="form-grid">
            <Field label="Winery" error={err('producer')} className="span-2">
              {(id, d) => (
                <input id={id} name="producer" list="dl-producers" value={form.producer} onChange={(e) => set('producer', e.target.value)} placeholder="e.g. Château Margaux" autoCapitalize="words" autoComplete="off" aria-describedby={d} aria-invalid={!!err('producer')} />
              )}
            </Field>
            <Field label="Owner family or company (optional)" hint="Wineries under one owner, in any region or country, are grouped together. It applies to all of this winery’s wines." className="span-2">
              {(id, d) => <input id={id} name="group" list="dl-groups" value={form.group} onChange={(e) => set('group', e.target.value)} placeholder="e.g. Antinori" autoCapitalize="words" autoComplete="off" aria-describedby={d} />}
            </Field>
            <Field label="Bottling / cuvée" error={err('bottling')} hint="The wine’s label name, e.g. “Grand Vin”, “Barolo Cannubi” or “Estate”." className="span-2">
              {(id, d) => (
                <input id={id} name="bottling" list="dl-bottlings" value={form.bottling} onChange={(e) => set('bottling', e.target.value)} placeholder="e.g. Grand Vin" autoCapitalize="words" autoComplete="off" aria-describedby={d} aria-invalid={!!err('bottling')} />
              )}
            </Field>
            {bottlingLocked && (
              <p className="notice span-2">
                <Icon name="check" size={16} /> You already have this bottling. Its colour, origin and varieties are shown below and are shared by all its vintages — {lockedNote.toLowerCase()}
              </p>
            )}
            {movesVintage && !bottlingLocked && (
              <p className="notice span-2">
                <Icon name="info" size={16} /> Changing the winery or bottling name moves just this vintage to that bottling.
              </p>
            )}
            <Field label="Colour" error={err('colour')} className="span-2">
              {(id) => (
                <div id={id} className="seg seg-wrap" role="group" aria-label="Colour">
                  {COLOURS.map((c, i) => (
                    <button key={c} type="button" name={i === 0 ? 'colour' : undefined} aria-pressed={form.colour === c} disabled={bottlingLocked} className={form.colour === c ? 'is-active' : undefined} onClick={() => set('colour', c)}>
                      {COLOUR_LABEL[c]}
                    </button>
                  ))}
                  <button type="button" aria-pressed={form.colour === 'unknown'} disabled={bottlingLocked} className={form.colour === 'unknown' ? 'is-active' : undefined} onClick={() => set('colour', 'unknown')}>
                    Not sure
                  </button>
                </div>
              )}
            </Field>
            <Field label="Still or sparkling" className="wide-on-phone">
              {(id) => (
                <div id={id} className="seg" role="group" aria-label="Still or sparkling">
                  <button type="button" aria-pressed={!form.sparkling} disabled={bottlingLocked} className={!form.sparkling ? 'is-active' : undefined} onClick={() => set('sparkling', false)}>
                    Still
                  </button>
                  <button type="button" aria-pressed={form.sparkling} disabled={bottlingLocked} className={form.sparkling ? 'is-active' : undefined} onClick={() => set('sparkling', true)}>
                    Sparkling
                  </button>
                </div>
              )}
            </Field>
            <Field label="Also (optional)" className="wide-on-phone">
              {(id) => (
                <div id={id} className="seg" role="group" aria-label="Sweet or fortified">
                  {WINE_STYLES.map((s) => (
                    <button key={s} type="button" aria-pressed={form.style === s} disabled={bottlingLocked} className={form.style === s ? 'is-active' : undefined} onClick={() => set('style', form.style === s ? '' : s)}>
                      {WINE_STYLE_LABEL[s]}
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
              {(id) => <input id={id} name="country" list="dl-countries" value={form.country} onChange={(e) => set('country', e.target.value)} disabled={bottlingLocked} autoCapitalize="words" autoComplete="off" />}
            </Field>
            <Field label="Region">
              {(id) => <input id={id} name="region" list="dl-regions" value={form.region} onChange={(e) => set('region', e.target.value)} disabled={bottlingLocked} placeholder="e.g. Bordeaux" autoCapitalize="words" autoComplete="off" />}
            </Field>
            <Field label="Appellation" className="span-2">
              {(id) => <input id={id} name="appellation" list="dl-appellations" value={form.appellation} onChange={(e) => set('appellation', e.target.value)} disabled={bottlingLocked} placeholder="e.g. Saint-Émilion Grand Cru" autoCapitalize="words" autoComplete="off" />}
            </Field>
          </div>
          <fieldset className="grapes" disabled={bottlingLocked} aria-describedby={err('grapes') ? 'grapes-error' : undefined}>
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
          {existingHasWindow ? (
            <p className="notice">
              <Icon name="info" size={16} /> This vintage already has a drinking window ({formatWindow({ drinkFrom: existingVintage?.drinkFrom, drinkTo: existingVintage?.drinkTo })}). Adding bottles doesn’t change it; to change it, open the wine and choose “Change”.
            </p>
          ) : (
            <>
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
            </>
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
              <PlacementPicker
                data={data}
                quantity={Number.isInteger(qtyNumber) && qtyNumber > 0 ? qtyNumber : 0}
                vintageId={existingVintage?.id ?? null}
                hint={{ bottlingId: matchedBottling?.id, producerId: matchedProducer?.id }}
                onChange={(p, pr) => {
                  setPlan(p);
                  setPlanProblem(pr);
                }}
              />
              {err('placements') && (
                <p className="field-error span-2" role="alert">
                  {err('placements')}
                </p>
              )}
            </div>
          </Card>
        )}

        <Card title="Notes">
          {existingVintage?.notes ? (
            <p className="notice">
              <Icon name="info" size={16} /> This vintage already has notes; edit them from the wine’s page.
            </p>
          ) : (
            <Field label="Notes about this vintage">
              {(id) => <textarea id={id} name="notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering about this vintage" />}
            </Field>
          )}
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
      <datalist id="dl-groups">
        {data.groups.map((g) => (
          <option key={g.id} value={g.name} />
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
