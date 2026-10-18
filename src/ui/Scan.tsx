import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addBarcode } from '../domain/actions';
import { barcodeProblem, formatBarcode, normalizeBarcode } from '../domain/barcode';
import { rowsForBarcode, wineTitle, type WineRow } from '../domain/inventory';
import { compareText, formatYear, pluralize, sizeBadge } from '../domain/text';
import { COLOUR_LABEL } from '../domain/types';
import { ReaderUnavailable, detectInFile, loadDetector, type Detector } from '../scan/detector';
import { LOOKUP_SOURCE, lookupBarcode, type LookupResult, type ProductGuess } from '../scan/lookup';
import { prefillFromProduct, prefillToSearch } from '../scan/prefill';
import { readLookupPreference, writeLookupPreference } from '../storage/storage';
import { useCellar, useRows } from '../storage/store';
import { Icon } from './Icon';
import { ConsumeDialog } from './Tasting';
import { Modal, useToast } from './overlays';
import { StatusBadge } from './status';
import { placementsLabel } from './format';

// ---- the camera ---------------------------------------------------------------------------------------

type CameraState = 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error' | 'reader';

const CAMERA_TEXT: Record<CameraState, string> = {
  starting: 'Starting the camera…',
  scanning: 'Point the camera at the barcode on the back label, and hold it still.',
  denied: 'The camera is blocked for this site. Allow it in the browser’s settings, or use one of the other ways below.',
  unavailable: 'This browser can’t use a camera here (it needs a secure page and a camera). Use one of the other ways below.',
  error: 'The camera couldn’t be started. Is another app using it? You can also use one of the other ways below.',
  reader: 'The barcode reader couldn’t be loaded. It is part of the app, so reload the page once while you have a connection. You can still type the number below.',
};

/**
 * The camera, reading barcodes until it is sure of one: the same valid number in two looks in a row,
 * so a stray misread never gets through. The camera is switched off the moment the view goes away.
 */
export function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<CameraState>('starting');
  const [attempt, setAttempt] = useState(0);
  const [torch, setTorch] = useState<{ can: boolean; on: boolean }>({ can: false, on: false });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState('starting');
    void loadDetector().catch(() => undefined); // start loading the reader while the camera wakes up

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e) {
        if (!stopped) setState(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'error');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const t = stream.getVideoTracks()[0] ?? null;
      track.current = t;
      const caps = (t?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ can: !!caps.torch, on: false });
      const el = video.current;
      if (!el) return;
      el.srcObject = stream;
      await el.play().catch(() => undefined);

      let detector: Detector;
      try {
        detector = await loadDetector();
      } catch {
        if (!stopped) setState('reader');
        return;
      }
      if (stopped) return;
      setState('scanning');

      let last: string | null = null;
      let lastAt = 0;
      const tick = async () => {
        if (stopped) return;
        if (el.readyState >= 2 && el.videoWidth > 0) {
          try {
            const code = (await detector.detect(el))[0];
            if (code) {
              const now = Date.now();
              if (code === last && now - lastAt < 1500) {
                navigator.vibrate?.(40);
                onCodeRef.current(code);
                return;
              }
              last = code;
              lastAt = now;
            }
          } catch {
            /* a frame that couldn't be read: the next one will do */
          }
        }
        timer = setTimeout(() => void tick(), 90);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
      if (video.current) video.current.srcObject = null;
    };
  }, [attempt]);

  const toggleTorch = async () => {
    const next = !torch.on;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ can: true, on: next });
    } catch {
      setTorch({ can: false, on: false });
    }
  };

  const failed = state === 'denied' || state === 'unavailable' || state === 'error' || state === 'reader';
  return (
    <div className="scanner" data-state={state}>
      {!failed && (
        <div className="scanner-view">
          <video ref={video} playsInline muted aria-label="Camera view" />
          <span className="scanner-guide" aria-hidden="true" />
        </div>
      )}
      <p className="scanner-msg" role="status">
        {CAMERA_TEXT[state]}
      </p>
      <div className="scanner-actions">
        {torch.can && state === 'scanning' && (
          <button type="button" className="btn btn-sm" aria-pressed={torch.on} onClick={() => void toggleTorch()}>
            {torch.on ? 'Light off' : 'Light on'}
          </button>
        )}
        {(state === 'denied' || state === 'error' || state === 'reader') && (
          <button type="button" className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Try the camera again
          </button>
        )}
      </div>
    </div>
  );
}

// ---- typing it, or using a picture ---------------------------------------------------------------------

function TypedEntry({ onCode, action }: { onCode: (code: string) => void; action: string }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useRef(`typed-${Math.random().toString(36).slice(2)}`).current;
  return (
    <form
      className="scan-typed"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeBarcode(text);
        if (code) onCode(code);
        else setProblem(barcodeProblem(text));
      }}
    >
      <label htmlFor={id}>Or type the number under the bars</label>
      <div className="scan-typed-row">
        <input id={id} inputMode="numeric" autoComplete="off" value={text} placeholder="e.g. 3 760001 230012" aria-describedby={problem ? `${id}-problem` : undefined} aria-invalid={!!problem} onChange={(e) => { setText(e.target.value); setProblem(null); }} />
        <button type="submit" className="btn btn-primary">
          {action}
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="field-error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

function PhotoEntry({ onCode }: { onCode: (code: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const code = (await detectInFile(file))[0];
      if (code) onCode(code);
      else setMessage('No barcode could be read in that picture. Take it closer, with the bars filling the frame, sharp and straight on.');
    } catch (e) {
      setMessage(e instanceof ReaderUnavailable ? 'The barcode reader couldn’t be loaded. Reload the page once while you have a connection, or type the number.' : 'That picture could not be read.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scan-photo">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="image" size={16} /> {busy ? 'Reading…' : 'Use a photo of the barcode'}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void read(f);
        }}
      />
      {message && (
        <p className="field-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

// ---- looking it up online (only when asked) ---------------------------------------------------------------

type LookupState = { kind: 'idle' } | { kind: 'loading' } | LookupResult;

function useProductLookup(code: string, auto: boolean): { state: LookupState; run: () => void } {
  const [state, setState] = useState<LookupState>({ kind: 'idle' });
  const live = useRef(true);
  const run = useCallback(() => {
    setState({ kind: 'loading' });
    void lookupBarcode(code).then((r) => {
      if (live.current) setState(r);
    });
  }, [code]);
  useEffect(() => {
    live.current = true;
    setState({ kind: 'idle' });
    if (auto) run();
    return () => {
      live.current = false;
    };
  }, [code, auto, run]);
  return { state, run };
}

const FAILURE_TEXT: Record<'offline' | 'busy' | 'error', string> = {
  offline: 'You seem to be offline, so the lookup couldn’t be made.',
  busy: `${LOOKUP_SOURCE} is busy right now.`,
  error: `${LOOKUP_SOURCE} could not be reached.`,
};

function GuessDetails({ p }: { p: ProductGuess }) {
  const rows: [string, string][] = [];
  if (p.winery) rows.push(['Winery', p.winery]);
  if (p.bottling) rows.push(['Bottling', p.bottling]);
  if (p.year) rows.push(['Vintage', String(p.year)]);
  if (p.sizeMl) rows.push(['Size', `${p.sizeMl} ml`]);
  if (p.colour) rows.push(['Colour', `${COLOUR_LABEL[p.colour]}${p.sparkling ? ', sparkling' : ''}`]);
  else if (p.sparkling) rows.push(['Type', 'Sparkling']);
  if (p.country) rows.push(['Country', p.country]);
  return (
    <dl className="facts scan-guess">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- picking a wine you already have ------------------------------------------------------------------------

function AttachPicker({ rows, onPick, onCancel }: { rows: WineRow[]; onPick: (bottlingId: string) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('');
  const bottlings = useMemo(() => {
    const seen = new Map<string, WineRow>();
    for (const r of rows) if (!seen.has(r.bottling.id)) seen.set(r.bottling.id, r);
    return [...seen.values()].sort((a, b) => compareText(`${a.producer.name} ${a.bottling.name}`, `${b.producer.name} ${b.bottling.name}`));
  }, [rows]);
  const q = query.trim().toLowerCase();
  const shown = bottlings.filter((r) => !q || `${r.producer.name} ${r.bottling.name}`.toLowerCase().includes(q)).slice(0, 30);
  return (
    <div className="scan-attach">
      <label className="search search-sm">
        <Icon name="search" size={16} />
        <span className="sr-only">Search your wines</span>
        <input type="search" placeholder="Search your wines…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </label>
      {shown.length === 0 ? (
        <p className="empty-note">No wine matches.</p>
      ) : (
        <ul className="plain-list scan-attach-list">
          {shown.map((r) => (
            <li key={r.bottling.id} className="attn-row">
              <span className="attn-title">
                {r.producer.name} · {r.bottling.name}
              </span>
              <button className="btn btn-sm" onClick={() => onPick(r.bottling.id)}>
                This one
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-quiet btn-sm" onClick={onCancel}>
        Never mind
      </button>
    </div>
  );
}

// ---- what a scan found --------------------------------------------------------------------------------------------

function VintageLine({ row, hasLayout, onDrink }: { row: WineRow; hasLayout: boolean; onDrink: (r: WineRow) => void }) {
  const badge = sizeBadge(row.vintage.sizeMl);
  const where = hasLayout && row.bottles > 0 ? placementsLabel(row) : null;
  return (
    <li className="scan-vintage">
      <div className="scan-vintage-main">
        <Link to={`/wine/${row.vintage.id}`} className="scan-vintage-title">
          {formatYear(row.vintage.year)}
          {badge ? ` · ${badge}` : ''}
        </Link>
        <span className="scan-vintage-meta">
          {row.bottles === 0 ? <span className="badge st-finished">Finished</span> : <StatusBadge status={row.status} short />}
          <span>{pluralize(row.bottles, 'bottle')}</span>
        </span>
        {where && <span className="scan-where">{where}</span>}
      </div>
      <div className="scan-vintage-actions">
        {row.bottles > 0 && (
          <button className="btn btn-sm" onClick={() => onDrink(row)} aria-label={`Drink a bottle of ${wineTitle(row)}`}>
            Drink
          </button>
        )}
        <Link className="btn btn-sm" to={`/wine/${row.vintage.id}?add=1`} aria-label={`Add bottles of ${wineTitle(row)}`}>
          Add bottles
        </Link>
      </div>
    </li>
  );
}

function ScanResult({ code, onAgain, onDrink }: { code: string; onAgain: () => void; onDrink: (row: WineRow) => void }) {
  const { data, apply } = useCellar();
  const { rows } = useRows();
  const toast = useToast();
  const navigate = useNavigate();
  const [preference, setPreference] = useState(readLookupPreference);
  const [attaching, setAttaching] = useState(false);
  const matches = useMemo(() => rowsForBarcode(rows, code), [rows, code]);
  const groups = useMemo(() => {
    const m = new Map<string, WineRow[]>();
    for (const r of matches) m.set(r.bottling.id, [...(m.get(r.bottling.id) ?? []), r]);
    return [...m.values()];
  }, [matches]);
  const known = matches.length > 0;
  const { state, run } = useProductLookup(code, !known && preference === 'auto');
  const hasLayout = data.locations.length > 0;

  const attach = (bottlingId: string) => {
    const r = apply((d) => addBarcode(d, bottlingId, code));
    if (!r.ok) return toast(r.error, { tone: 'error' });
    const row = rows.find((x) => x.bottling.id === bottlingId);
    toast(`Barcode saved on ${row ? `${row.producer.name} · ${row.bottling.name}` : 'that wine'}. It will be recognised next time.${r.alsoOn.length ? ` (It is also on ${r.alsoOn.map((b) => b.name).join(', ')}.)` : ''}`);
    setAttaching(false);
  };

  const goAdd = (search: string) => navigate(`/wine/new?${search}`);

  let body: ReactNode;
  if (known) {
    body = (
      <>
        <h3 className="scan-heading">In your cellar</h3>
        {groups.map((g) => {
          const first = g[0] as WineRow;
          return (
            <section key={first.bottling.id} className="scan-found">
              <h4>
                {first.producer.name} · {first.bottling.name}
              </h4>
              <ul className="plain-list">
                {g.map((r) => (
                  <VintageLine key={r.vintage.id} row={r} hasLayout={hasLayout} onDrink={onDrink} />
                ))}
              </ul>
              <Link className="btn btn-quiet btn-sm" to={`/wine/new?${prefillToSearch({ bottlingId: first.bottling.id, barcode: code })}`}>
                <Icon name="plus" size={16} /> A different vintage
              </Link>
            </section>
          );
        })}
      </>
    );
  } else {
    const product = state.kind === 'found' ? state.product : null;
    body = (
      <>
        <h3 className="scan-heading">Not in your cellar yet</h3>

        {state.kind === 'idle' && (
          <div className="notice scan-ask">
            <div>
              <p>
                Look it up on <strong>{LOOKUP_SOURCE}</strong>, a free community database? Only the barcode number is sent. Wines are only partly covered there, so it may not know this one.
              </p>
              <label className="check check-sm">
                <input
                  type="checkbox"
                  checked={preference === 'auto'}
                  onChange={(e) => {
                    const next = e.target.checked ? 'auto' : 'ask';
                    writeLookupPreference(next);
                    setPreference(next); // turning it on starts this lookup too (the lookup hook reacts to the change)
                  }}
                />
                Do this automatically from now on
              </label>
              <button className="btn btn-sm btn-primary" onClick={run}>
                Look it up
              </button>
            </div>
          </div>
        )}
        {state.kind === 'loading' && (
          <p className="scan-status" role="status">
            Looking it up on {LOOKUP_SOURCE}…
          </p>
        )}
        {product && (
          <section className="scan-product" aria-label={`Found: ${product.title}`}>
            {product.imageUrl && <img src={product.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="scan-product-img" />}
            <div>
              <p>
                <strong>{product.title}</strong>
                <br />
                <span className="muted">From {LOOKUP_SOURCE}</span>
              </p>
              {product.isWine ? (
                <>
                  <GuessDetails p={product} />
                  <p className="card-sub">Typed in by volunteers, so check it against the label. You can correct anything on the next screen.</p>
                  <button className="btn btn-sm btn-primary" onClick={() => goAdd(prefillToSearch(prefillFromProduct(product)))}>
                    <Icon name="plus" size={16} /> Add this wine
                  </button>
                </>
              ) : (
                <p className="field-error">That doesn’t look like a wine. If it is, add it by hand below.</p>
              )}
            </div>
          </section>
        )}
        {state.kind === 'not-found' && <p className="scan-status">{LOOKUP_SOURCE} doesn’t list this bottle. That is common for wines: add it once and it will be recognised from then on.</p>}
        {state.kind === 'failed' && (
          <p className="scan-status">
            {FAILURE_TEXT[state.reason]}{' '}
            <button className="btn btn-quiet btn-sm" onClick={run}>
              Try again
            </button>
          </p>
        )}

        {attaching ? (
          <AttachPicker rows={rows} onPick={attach} onCancel={() => setAttaching(false)} />
        ) : (
          <div className="scan-next">
            {!(product && product.isWine) && (
              <button className="btn btn-sm btn-primary" onClick={() => goAdd(prefillToSearch({ barcode: code }))}>
                <Icon name="plus" size={16} /> Add it as a new wine
              </button>
            )}
            {rows.length > 0 && (
              <button className="btn btn-sm" onClick={() => setAttaching(true)}>
                It’s a wine I already have…
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="scan-result" aria-live="polite">
      <p className="scan-code">
        <Icon name="barcode" size={18} /> <strong>{formatBarcode(code)}</strong>
        <button className="btn btn-quiet btn-sm" onClick={onAgain}>
          Scan another
        </button>
      </p>
      {body}
    </div>
  );
}

// ---- the dialog ----------------------------------------------------------------------------------------------------------

/**
 * Scan a bottle. In the default mode it finds the wine in your cellar (or offers to look it up and add
 * it); in `capture` mode it only reads a barcode and hands it back (the add form and a wine's page use it
 * to attach a barcode).
 */
export function ScanDialog({ onClose, mode = 'identify', onCapture }: { onClose: () => void; mode?: 'identify' | 'capture'; onCapture?: (code: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [drinking, setDrinking] = useState<WineRow | null>(null);

  const got = (c: string) => {
    if (mode === 'capture') {
      onCapture?.(c);
      onClose();
    } else setCode(c);
  };

  // The camera view is replaced (not stacked) while a dialog for drinking is open; closing it brings the result back.
  if (drinking) return <ConsumeDialog row={drinking} onClose={() => setDrinking(null)} />;

  return (
    <Modal
      wide
      title={mode === 'capture' ? 'Read a barcode' : 'Scan a bottle'}
      onClose={onClose}
      footer={
        // Focus starts here, not in the number box: on a phone, focusing a text box raises the keyboard over the camera.
        <button className="btn" data-autofocus onClick={onClose}>
          Close
        </button>
      }
    >
      {code === null ? (
        <>
          <CameraScanner onCode={got} />
          <TypedEntry onCode={got} action={mode === 'capture' ? 'Use this number' : 'Find it'} />
          <PhotoEntry onCode={got} />
        </>
      ) : (
        <ScanResult code={code} onAgain={() => setCode(null)} onDrink={setDrinking} />
      )}
    </Modal>
  );
}

/** A button that opens the scanner, for the places that just need one. */
export function ScanButton({ label = 'Scan bottle', className = 'btn' }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="barcode" size={18} /> {label}
      </button>
      {open && <ScanDialog onClose={() => setOpen(false)} />}
    </>
  );
}
