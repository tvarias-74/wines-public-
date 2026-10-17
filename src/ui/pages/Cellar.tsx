import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NOT_SET, filterRows, groupByProducer, wineTitle, type RowFilter, type WineRow } from '../../domain/inventory';
import { WINE_TYPES, WINE_TYPE_LABEL, type WineType } from '../../domain/types';
import { compareText, formatYear, pluralize } from '../../domain/text';
import { STATUS_LABEL, STATUS_ORDER, describeStatus, formatPeak, formatWindow, windowOf, type WindowStatus } from '../../domain/window';
import { useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, ConsumeDialog, EmptyNote, PageHead, WineRowItem } from '../components';
import { ShowMore, useIncremental } from '../incremental';
import { bottlingSummary } from '../format';
import { StatusBadge, WindowTrack, yearPosition, type Domain } from '../status';

type View = 'producers' | 'wines' | 'timeline';
const VIEWS: { id: View; label: string }[] = [
  { id: 'producers', label: 'By producer' },
  { id: 'wines', label: 'All wines' },
  { id: 'timeline', label: 'Timeline' },
];

type Sort = 'drink' | 'producer' | 'newest' | 'oldest' | 'bottles' | 'bought' | 'price';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'drink', label: 'Drink first' },
  { id: 'producer', label: 'Producer A–Z' },
  { id: 'newest', label: 'Newest vintage' },
  { id: 'oldest', label: 'Oldest vintage' },
  { id: 'bottles', label: 'Most bottles' },
  { id: 'bought', label: 'Recently bought' },
  { id: 'price', label: 'Highest price paid' },
];

function sortRows(rows: WineRow[], sort: Sort): WineRow[] {
  const byName = (a: WineRow, b: WineRow) => compareText(a.producer.name, b.producer.name) || compareText(a.bottling.name, b.bottling.name) || (b.vintage.year ?? 0) - (a.vintage.year ?? 0);
  const out = [...rows];
  switch (sort) {
    case 'drink':
      return out.sort((a, b) => (a.vintage.drinkTo ?? 9999) - (b.vintage.drinkTo ?? 9999) || byName(a, b));
    case 'newest':
      return out.sort((a, b) => (b.vintage.year ?? 9999) - (a.vintage.year ?? 9999) || byName(a, b));
    case 'oldest':
      return out.sort((a, b) => (a.vintage.year ?? 9999) - (b.vintage.year ?? 9999) || byName(a, b));
    case 'bottles':
      return out.sort((a, b) => b.bottles - a.bottles || byName(a, b));
    case 'bought':
      return out.sort((a, b) => (b.lastPurchase ?? '').localeCompare(a.lastPurchase ?? '') || byName(a, b));
    case 'price':
      return out.sort((a, b) => (b.avgPrice ?? -1) - (a.avgPrice ?? -1) || byName(a, b));
    default:
      return out.sort(byName);
  }
}

const isStatus = (v: string | null): v is WindowStatus => !!v && (STATUS_ORDER as string[]).includes(v);
const isType = (v: string | null): v is WineType => !!v && (WINE_TYPES as readonly string[]).includes(v);

export function Cellar() {
  const { data, rows, now } = useRows();
  const [params, setParams] = useSearchParams();
  const [drinking, setDrinking] = useState<WineRow | null>(null);

  const viewParam = params.get('view');
  const view: View = VIEWS.some((v) => v.id === viewParam) ? (viewParam as View) : 'producers';
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.some((s) => s.id === sortParam) ? (sortParam as Sort) : 'drink';
  const query = params.get('q') ?? '';
  const statusParam = params.get('status');
  const typeParam = params.get('type');
  const filter: RowFilter = {
    query,
    status: isStatus(statusParam) ? statusParam : '',
    type: isType(typeParam) ? typeParam : '',
    country: params.get('country') ?? '',
    includeFinished: params.get('finished') === '1',
  };
  const filtered = !!(filter.query || filter.status || filter.type || filter.country || filter.includeFinished);

  // Always build the next URL from the *latest* parameters: the debounced search update below fires
  // later, and must not overwrite a filter chosen in the meantime.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(paramsRef.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    paramsRef.current = next;
    setParams(next, { replace: true });
  };

  // The box updates instantly; the URL (and so the whole page) follows once typing pauses.
  const [queryInput, setQueryInput] = useState(query);
  useEffect(() => setQueryInput(query), [query]);
  useEffect(() => {
    if (queryInput === query) return;
    const t = setTimeout(() => update({ q: queryInput || null }), 200);
    return () => clearTimeout(t);
  }, [queryInput]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    let hasNone = false;
    for (const r of rows) {
      if (r.bottling.country) set.add(r.bottling.country);
      else hasNone = true;
    }
    return { list: [...set].sort(compareText), hasNone };
  }, [rows]);

  // `filter` is derived entirely from the URL, so the URL string is the cache key.
  const paramsKey = params.toString();
  const list = useMemo(() => filterRows(rows, filter), [rows, paramsKey]);
  const bottles = list.reduce((n, r) => n + r.bottles, 0);
  const year = now.getFullYear();
  const currency = data.settings.currency;

  return (
    <>
      <PageHead
        title="Cellar"
        subtitle={`${pluralize(bottles, 'bottle')} · ${pluralize(list.filter((r) => r.bottles > 0).length, 'wine')}${filtered ? ' match' : ''}`}
        actions={
          <Link className="btn btn-primary" to="/wine/new">
            <Icon name="plus" size={18} /> Add wine
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">Search your cellar</span>
          <input type="search" placeholder="Search producer, wine, grape, region…" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} className={view === v.id ? 'is-active' : undefined} onClick={() => update({ view: v.id === 'producers' ? null : v.id })}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filter by drinking window">
        <button className={`chip-btn${filter.status === '' ? ' is-active' : ''}`} aria-pressed={filter.status === ''} onClick={() => update({ status: null })}>
          All
        </button>
        {STATUS_ORDER.map((s) => (
          <button key={s} className={`chip-btn${filter.status === s ? ' is-active' : ''}`} aria-pressed={filter.status === s} onClick={() => update({ status: filter.status === s ? null : s })}>
            <i className={`dot st-${s}`} aria-hidden="true" />
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="filters">
        <label>
          <span className="sr-only">Type</span>
          <select value={filter.type} onChange={(e) => update({ type: e.target.value || null })}>
            <option value="">All types</option>
            {WINE_TYPES.map((t) => (
              <option key={t} value={t}>
                {WINE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Country</span>
          <select value={filter.country} onChange={(e) => update({ country: e.target.value || null })}>
            <option value="">All countries</option>
            {countries.list.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {countries.hasNone && <option value={NOT_SET}>Country not set</option>}
          </select>
        </label>
        {view === 'wines' && (
          <label>
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => update({ sort: e.target.value === 'drink' ? null : e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={!!filter.includeFinished} onChange={(e) => update({ finished: e.target.checked ? '1' : null })} />
          Include finished wines
        </label>
        {filtered && (
          <button className="btn btn-quiet btn-sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyNote>
            {rows.length === 0 ? (
              <>
                Your cellar is empty. <Link to="/wine/new">Add your first wine</Link>.
              </>
            ) : (
              'No wines match these filters.'
            )}
          </EmptyNote>
        </Card>
      ) : view === 'producers' ? (
        <ProducerTree rows={list} forceOpen={filtered} onDrink={setDrinking} currency={currency} year={year} />
      ) : view === 'wines' ? (
        <FlatList rows={list} sort={sort} onDrink={setDrinking} currency={currency} year={year} />
      ) : (
        <Timeline rows={list} now={now} />
      )}

      {drinking && <ConsumeDialog row={drinking} onClose={() => setDrinking(null)} />}
    </>
  );
}

function FlatList({ rows, sort, onDrink, currency, year }: { rows: WineRow[]; sort: Sort; onDrink: (r: WineRow) => void; currency: string; year: number }) {
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const { visible, remaining, more, all } = useIncremental(sorted);
  return (
    <>
      <Card className="flush">
        <div className="wine-list">
          {visible.map((r) => (
            <WineRowItem key={r.vintage.id} row={r} showTitle onDrink={onDrink} currency={currency} nowYear={year} />
          ))}
        </div>
      </Card>
      <ShowMore remaining={remaining} onMore={more} onAll={all} noun="wines" />
    </>
  );
}

function ProducerTree({ rows, forceOpen, onDrink, currency, year }: { rows: WineRow[]; forceOpen: boolean; onDrink: (r: WineRow) => void; currency: string; year: number }) {
  const groups = useMemo(() => groupByProducer(rows), [rows]);
  const [mode, setMode] = useState<'auto' | 'all' | 'none'>('auto');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const defaultOpen = mode === 'all' ? true : mode === 'none' ? false : forceOpen || groups.length <= 6;
  const isOpen = (id: string) => overrides[id] ?? defaultOpen;

  return (
    <>
      <div className="tree-tools">
        <button className="btn btn-quiet btn-sm" onClick={() => { setMode('all'); setOverrides({}); }}>
          Expand all
        </button>
        <button className="btn btn-quiet btn-sm" onClick={() => { setMode('none'); setOverrides({}); }}>
          Collapse all
        </button>
      </div>
      {groups.map((g) => {
        const open = isOpen(g.producer.id);
        return (
          <section key={g.producer.id} className="card producer">
            <button className="producer-head" aria-expanded={open} onClick={() => setOverrides((o) => ({ ...o, [g.producer.id]: !open }))}>
              <span className={`chev${open ? ' is-open' : ''}`}>
                <Icon name="chevron" size={18} />
              </span>
              <span className="producer-name">{g.producer.name}</span>
              <span className="producer-count">
                <b>{g.bottles}</b> {g.bottles === 1 ? 'bottle' : 'bottles'}
                <span className="muted"> · {pluralize(g.vintages, 'vintage')}</span>
              </span>
            </button>
            {open &&
              g.bottlings.map((b) => (
                <div key={b.bottling.id} className="bottling">
                  <div className="bottling-head">
                    <h3>{b.bottling.name}</h3>
                    <span className="bottling-count">{pluralize(b.bottles, 'bottle')}</span>
                  </div>
                  <p className="bottling-meta">{bottlingSummary(b.bottling)}</p>
                  <div className="wine-list">
                    {b.rows.map((r) => (
                      <WineRowItem key={r.vintage.id} row={r} onDrink={onDrink} currency={currency} nowYear={year} />
                    ))}
                  </div>
                </div>
              ))}
          </section>
        );
      })}
    </>
  );
}

const AXIS_BEFORE = 4;
const AXIS_AFTER = 16;

function Timeline({ rows, now }: { rows: WineRow[]; now: Date }) {
  const year = now.getFullYear();
  const nowPos = yearPosition(now);
  const domain: Domain = { start: year - AXIS_BEFORE, end: year + AXIS_AFTER };
  const withWindow = useMemo(
    () =>
      rows
        .filter((r) => r.vintage.drinkFrom !== undefined || r.vintage.drinkTo !== undefined)
        .sort((a, b) => (a.vintage.drinkTo ?? 9999) - (b.vintage.drinkTo ?? 9999) || compareText(a.producer.name, b.producer.name)),
    [rows],
  );
  const { visible: shownWindows, remaining: moreWindows, more: showMoreWindows, all: showAllWindows } = useIncremental(withWindow);
  const without = rows.filter((r) => r.vintage.drinkFrom === undefined && r.vintage.drinkTo === undefined && r.bottles > 0);
  const ticks: number[] = [];
  for (let y = domain.start; y <= domain.end; y += 4) ticks.push(y);

  return (
    <>
      <Card title="When to drink" subtitle={`Each bar is a drinking window, soonest to close first. The line is today. Showing ${domain.start}–${domain.end}.`}>
        <ul className="legend legend-inline" aria-label="Legend">
          <li><i className="swatch st-ready" aria-hidden="true" /> Drinking window</li>
          <li><i className="swatch swatch-peak" aria-hidden="true" /> Peak</li>
          <li><i className="swatch swatch-now" aria-hidden="true" /> Today</li>
        </ul>
        {withWindow.length === 0 ? (
          <EmptyNote>None of these wines has a drinking window yet.</EmptyNote>
        ) : (
          <div className="timeline">
            <div className="tl-axis" aria-hidden="true">
              <span className="tl-axis-pad" />
              <span className="tl-axis-scale">
                {ticks.map((t) => (
                  <span key={t} style={{ left: `${((t - domain.start) / (domain.end - domain.start)) * 100}%` }}>
                    {t}
                  </span>
                ))}
              </span>
            </div>
            <ul className="tl-rows">
              {shownWindows.map((r) => {
                const w = windowOf(r.vintage);
                const peak = formatPeak(w);
                return (
                  <li key={r.vintage.id} className={r.bottles === 0 ? 'is-finished' : undefined}>
                    <Link to={`/wine/${r.vintage.id}`} className="tl-row">
                      <span className="tl-label">
                        <span className="tl-title">{wineTitle(r)}</span>
                        <span className="tl-meta">
                          {r.bottles === 0 ? <span className="badge st-finished">Finished</span> : <StatusBadge status={r.status} short />}
                          <span>{formatWindow(w)}</span>
                          {peak && <span className="muted">peak {peak}</span>}
                          {r.bottles > 0 && <span className="muted">{pluralize(r.bottles, 'bottle')}</span>}
                        </span>
                      </span>
                      <span className="tl-track" role="img" aria-label={`${wineTitle(r)}: window ${formatWindow(w)}${peak ? `, peak ${peak}` : ''}. ${describeStatus(w, r.status, year)}`}>
                        <WindowTrack window={w} status={r.status} domain={domain} nowPos={nowPos} compact />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <ShowMore remaining={moreWindows} onMore={showMoreWindows} onAll={showAllWindows} noun="wines" />
      </Card>
      {without.length > 0 && (
        <Card title="No drinking window set" subtitle="These wines can’t be placed on the timeline yet.">
          <ul className="plain-list">
            {without.map((r) => (
              <li key={r.vintage.id} className="attn-row">
                <Link to={`/wine/${r.vintage.id}`}>
                  <span className="attn-title">
                    {r.producer.name} · {r.bottling.name} {formatYear(r.vintage.year)}
                  </span>
                </Link>
                <span className="attn-count">{pluralize(r.bottles, 'bottle')}</span>
                <Link className="btn btn-quiet btn-sm" to={`/wine/${r.vintage.id}/edit#window`}>
                  Set window
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
