import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { niceScale } from './chartMath';

// ---- tooltip ------------------------------------------------------------------

interface TipRow {
  label: string;
  value: string;
  color?: string;
}
type Placement = 'side' | 'below';
interface TipState {
  x: number;
  y: number;
  /** Which way the box extends from (x, y). */
  anchor: 'left' | 'right' | 'below';
  title: string;
  rows: TipRow[];
}

const TIP_WIDTH = 180; // rough, for keeping the box inside the chart

/**
 * One shared tooltip per chart. It follows hover and keyboard focus, and a tap
 * on touch screens (where hover does not exist). All text goes in as React text
 * nodes, never as HTML.
 */
function useTooltip() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback((el: Element, title: string, rows: TipRow[], placement: Placement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    if (placement === 'below') {
      const half = Math.min(TIP_WIDTH / 2, w.width / 2);
      const x = Math.min(Math.max(r.left + r.width / 2 - w.left, half), w.width - half);
      setTip({ x, y: r.bottom - w.top, anchor: 'below', title, rows });
      return;
    }
    // Beside the column, on whichever side has room, so it never covers the header or the bar itself.
    const centre = r.left + r.width / 2 - w.left;
    if (centre < w.width / 2) setTip({ x: Math.min(r.right - w.left + 4, Math.max(0, w.width - TIP_WIDTH)), y: r.top - w.top + 6, anchor: 'right', title, rows });
    else setTip({ x: Math.max(r.left - w.left - 4, Math.min(TIP_WIDTH, w.width)), y: r.top - w.top + 6, anchor: 'left', title, rows });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-tip-target]')) setTip(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [tip]);

  const node = tip && (
    <div className={`tooltip is-${tip.anchor}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="tooltip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          {r.color && <i className="tooltip-key" style={{ background: r.color }} aria-hidden="true" />}
          <span className="tooltip-value">{r.value}</span>
          <span className="tooltip-label">{r.label}</span>
        </div>
      ))}
    </div>
  );

  const handlers = (title: string, rows: TipRow[], placement: Placement = 'side') => ({
    'data-tip-target': '',
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && show(e.currentTarget, title, rows, placement),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && hide(),
    onFocus: (e: React.FocusEvent) => show(e.currentTarget, title, rows, placement),
    onBlur: hide,
    onClick: (e: React.MouseEvent) => show(e.currentTarget, title, rows, placement),
  });

  return { wrapRef, node, handlers };
}

// ---- legend & table twin ------------------------------------------------------

export interface SeriesDef {
  id: string;
  label: string;
  /** Any CSS colour, normally a `var(--…)` token so light/dark swap in one place. */
  color: string;
}

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <ul className="legend" aria-label="Legend">
      {series.map((s) => (
        <li key={s.id}>
          <i className="swatch" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TableTwin({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="twin">
      <summary>View as table</summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} scope="col" className={i > 0 ? 'num' : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i} className="num">{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---- stacked horizontal bar (part of a whole) -----------------------------------

export interface BarSegment {
  id: string;
  label: string;
  value: number;
  color: string;
  to?: string;
}

export function StackedBar({ segments, unit = 'bottle' }: { segments: BarSegment[]; unit?: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const { wrapRef, node, handlers } = useTooltip();
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : '0%');
  const plural = (n: number) => `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;

  return (
    <div className="viz" ref={wrapRef}>
      <div className="sbar" role="img" aria-label={segments.map((s) => `${s.label}: ${plural(s.value)}`).join('; ')}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const rowsTip = [{ label: plural(s.value), value: pct(s.value), color: s.color }];
            const common = { className: 'sbar-seg', style: { flexGrow: s.value, background: s.color } as CSSProperties, ...handlers(s.label, rowsTip, 'below') };
            return s.to ? <Link key={s.id} to={s.to} aria-label={`${s.label}: ${plural(s.value)}`} {...common} /> : <span key={s.id} {...common} />;
          })}
      </div>
      {node}
      <ul className="legend-grid">
        {segments.map((s) => {
          const inner = (
            <>
              <i className="swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="legend-label">{s.label}</span>
              <span className="legend-count">{s.value.toLocaleString()}</span>
              <span className="legend-pct">{pct(s.value)}</span>
            </>
          );
          return (
            <li key={s.id} className={s.value === 0 ? 'is-zero' : undefined}>
              {s.to && s.value > 0 ? <Link to={s.to}>{inner}</Link> : <div>{inner}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- columns (one or several stacked series over categories) --------------------

export interface ColumnDatum {
  key: string;
  label: string;
  /** Used for the axis label on narrow screens, e.g. ’27 for 2027. */
  shortLabel?: string;
  values: Record<string, number>;
  /** Draws attention to one column, e.g. the current year. */
  emphasis?: boolean;
}

export function ColumnChart({
  data,
  series,
  caption,
  format = (n) => n.toLocaleString(),
  capFormat,
  unit = 'bottles',
  showCaps = true,
}: {
  data: ColumnDatum[];
  series: SeriesDef[];
  caption: string;
  format?: (n: number) => string;
  /** Shorter formatting for the value on the cap, e.g. compact currency. */
  capFormat?: (n: number) => string;
  unit?: string;
  /** Print each column's total on its cap. Off when the totals are all the same (or the axis says enough). */
  showCaps?: boolean;
}) {
  const { wrapRef, node, handlers } = useTooltip();
  const totals = data.map((d) => series.reduce((n, s) => n + (d.values[s.id] ?? 0), 0));
  const scale = niceScale(Math.max(0, ...totals));
  const showLegend = series.length > 1;
  const n = data.length;

  return (
    <div className="viz" ref={wrapRef} style={{ '--cols': n } as CSSProperties}>
      <div className="chart" role="group" aria-label={caption}>
        <div className="chart-plot">
          <div className="chart-area">
            {scale.ticks.map((t) => (
              <div key={t} className="chart-grid" style={{ bottom: `${(t / scale.max) * 100}%` }}>
                <span className="chart-tick">{capFormat ? capFormat(t) : t.toLocaleString()}</span>
              </div>
            ))}
            <div className="chart-cols">
              {data.map((d, i) => {
                const total = totals[i] ?? 0;
                const active = series.filter((s) => (d.values[s.id] ?? 0) > 0);
                const rowsTip = [
                  ...active.map((s) => ({ label: s.label, value: format(d.values[s.id] ?? 0), color: s.color })),
                  ...(active.length > 1 ? [{ label: 'Total', value: format(total) }] : []),
                ];
                const aria = `${d.label}: ${total === 0 ? `no ${unit}` : active.map((s) => `${format(d.values[s.id] ?? 0)} ${showLegend ? s.label : unit}`).join(', ')}`;
                return (
                  <button type="button" key={d.key} className={`chart-col${d.emphasis ? ' is-now' : ''}`} aria-label={aria} {...handlers(d.label, rowsTip.length ? rowsTip : [{ label: unit, value: '0' }])}>
                    {total > 0 && (
                      <span className="chart-stack" style={{ height: `${(total / scale.max) * 100}%` }}>
                        {showCaps && <span className="chart-cap">{capFormat ? capFormat(total) : format(total)}</span>}
                        {active.map((s, idx) => (
                          <span
                            key={s.id}
                            className={`chart-seg${idx === active.length - 1 ? ' is-top' : ''}`}
                            style={{ flexGrow: d.values[s.id] ?? 0, background: s.color }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="chart-xaxis">
          {data.map((d) => (
            <span key={d.key} className={d.emphasis ? 'is-now' : undefined}>
              <span className="xl-full">{d.label}</span>
              <span className="xl-short">{d.shortLabel ?? d.label}</span>
            </span>
          ))}
        </div>
        {node}
      </div>
      {showLegend && <Legend series={series} />}
      <TableTwin
        caption={caption}
        head={['', ...series.map((s) => s.label), ...(showLegend ? ['Total'] : [])]}
        rows={data.map((d, i) => [d.label, ...series.map((s) => format(d.values[s.id] ?? 0)), ...(showLegend ? [format(totals[i] ?? 0)] : [])])}
      />
    </div>
  );
}

// ---- ranked horizontal bars (magnitude by category) -----------------------------

export interface RankItem {
  key: string;
  label: string;
  value: number;
  to?: string;
}

export function RankBars({ items, format = (n) => n.toLocaleString() }: { items: RankItem[]; format?: (n: number) => string }): ReactNode {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="rank">
      {items.map((i) => {
        const inner = (
          <>
            <span className="rank-label">{i.label}</span>
            <span className="rank-track" style={{ '--p': i.value / max } as CSSProperties}>
              <span className="rank-bar" />
              <span className="rank-val">{format(i.value)}</span>
            </span>
          </>
        );
        return <li key={i.key}>{i.to ? <Link className="rank-row" to={i.to}>{inner}</Link> : <div className="rank-row">{inner}</div>}</li>;
      })}
    </ul>
  );
}
