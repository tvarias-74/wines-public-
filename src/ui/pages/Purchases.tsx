import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { purchaseEntries, purchasesByYear, wineTitle, type PurchaseEntry } from '../../domain/inventory';
import { formatDate, formatMoney, normalizeText, pluralize } from '../../domain/text';
import { useRows } from '../../storage/store';
import { Card, EmptyNote, PageHead, Stat } from '../components';
import { ColumnChart, RankBars } from '../charts';
import { ShowMore, useIncremental } from '../incremental';

type Measure = 'bottles' | 'spent';

export function Purchases() {
  const { data, now } = useRows();
  const currency = data.settings.currency;
  const [params, setParams] = useSearchParams();
  const [measure, setMeasure] = useState<Measure>('bottles');
  const entries = useMemo(() => purchaseEntries(data), [data]);
  const years = useMemo(() => purchasesByYear(entries), [entries]);

  const yearParam = params.get('year') ?? 'all';
  const shown = useMemo(
    () => entries.filter((e) => (yearParam === 'all' ? true : yearParam === 'none' ? !e.purchase.date : e.purchase.date?.startsWith(yearParam))),
    [entries, yearParam],
  );
  const setYear = (y: string) => setParams(y === 'all' ? {} : { year: y }, { replace: true });

  const totals = useMemo(() => {
    let bottles = 0;
    let spent = 0;
    let priced = 0;
    for (const { purchase: p } of shown) {
      bottles += p.quantity;
      if (p.unitPrice !== undefined) {
        spent += p.unitPrice * p.quantity;
        priced += p.quantity;
      }
    }
    return { bottles, spent, priced, avg: priced ? spent / priced : null };
  }, [shown]);

  // One column per calendar year, including quiet years, so gaps in buying are visible.
  const chart = useMemo(() => {
    const dated = years.filter((y) => y.year !== null) as (typeof years[number] & { year: number })[];
    if (dated.length === 0) return [];
    const maxYear = Math.max(now.getFullYear(), ...dated.map((y) => y.year));
    const minYear = Math.max(Math.min(...dated.map((y) => y.year)), maxYear - 11);
    const byYear = new Map(dated.map((y) => [y.year, y]));
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => {
      const year = minYear + i;
      const b = byYear.get(year);
      return { key: String(year), label: String(year), shortLabel: `’${String(year).slice(2)}`, emphasis: year === now.getFullYear(), values: { v: measure === 'bottles' ? (b?.bottles ?? 0) : Math.round(b?.spent ?? 0) } };
    });
  }, [years, measure, now]);
  const olderHidden = useMemo(() => years.some((y) => y.year !== null && chart.length > 0 && y.year < Number(chart[0]?.key)), [years, chart]);

  const merchants = useMemo(() => {
    const m = new Map<string, { label: string; bottles: number }>();
    for (const { purchase: p } of entries) {
      const name = p.merchant?.trim();
      if (!name) continue;
      const key = normalizeText(name);
      const cur = m.get(key) ?? { label: name, bottles: 0 };
      cur.bottles += p.quantity;
      m.set(key, cur);
    }
    return [...m.entries()].map(([key, v]) => ({ key, label: v.label, value: v.bottles })).sort((a, b) => b.value - a.value);
  }, [entries]);

  // Year headers always describe the whole year, even when only part of its list is on screen.
  const yearTotals = useMemo(() => {
    const m = new Map<string, { bottles: number; spent: number; anyPrice: boolean }>();
    for (const { purchase: p } of shown) {
      const k = p.date ? p.date.slice(0, 4) : 'none';
      const t = m.get(k) ?? { bottles: 0, spent: 0, anyPrice: false };
      t.bottles += p.quantity;
      if (p.unitPrice !== undefined) {
        t.spent += p.unitPrice * p.quantity;
        t.anyPrice = true;
      }
      m.set(k, t);
    }
    return m;
  }, [shown]);
  const { visible: visibleEntries, remaining: moreEntries, more: showMoreEntries, all: showAllEntries } = useIncremental(shown);
  const groups = useMemo(() => {
    const out = new Map<string, PurchaseEntry[]>();
    for (const e of visibleEntries) {
      const k = e.purchase.date ? e.purchase.date.slice(0, 4) : 'none';
      out.set(k, [...(out.get(k) ?? []), e]);
    }
    return [...out.entries()];
  }, [visibleEntries]);

  const compactMoney = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch {
      return String(n);
    }
  };

  if (entries.length === 0) {
    return (
      <>
        <PageHead title="Purchases" subtitle="What you bought, when, and what you paid." />
        <Card>
          <EmptyNote>
            No purchases yet. <Link to="/wine/new">Add a wine</Link> and record the bottles you bought.
          </EmptyNote>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead title="Purchases" subtitle="What you bought, when, and what you paid." />

      <Card
        title="Bought per year"
        action={
          <div className="seg seg-sm" role="group" aria-label="Measure">
            <button aria-pressed={measure === 'bottles'} className={measure === 'bottles' ? 'is-active' : undefined} onClick={() => setMeasure('bottles')}>
              Bottles
            </button>
            <button aria-pressed={measure === 'spent'} className={measure === 'spent' ? 'is-active' : undefined} onClick={() => setMeasure('spent')}>
              Spent
            </button>
          </div>
        }
      >
        {chart.length === 0 ? (
          <EmptyNote>None of your purchases has a date, so they can’t be placed on a timeline.</EmptyNote>
        ) : (
          <ColumnChart
            caption={measure === 'bottles' ? 'Bottles bought per year' : `Money spent per year (${currency})`}
            series={[{ id: 'v', label: measure === 'bottles' ? 'Bottles bought' : `Spent (${currency})`, color: 'var(--accent-viz)' }]}
            data={chart}
            unit={measure === 'bottles' ? 'bottles' : currency}
            format={measure === 'bottles' ? (n) => n.toLocaleString() : (n) => formatMoney(n, currency, 0)}
            capFormat={measure === 'bottles' ? undefined : compactMoney}
          />
        )}
        {olderHidden && <p className="card-foot muted">Showing the latest 12 years; older purchases are in the list below.</p>}
        {measure === 'spent' && <p className="card-foot muted">Only bottles with a recorded price are counted.</p>}
      </Card>

      <div className="chips" role="group" aria-label="Filter by year">
        <button className={`chip-btn${yearParam === 'all' ? ' is-active' : ''}`} aria-pressed={yearParam === 'all'} onClick={() => setYear('all')}>
          All years
        </button>
        {years.map((y) => {
          const k = y.year === null ? 'none' : String(y.year);
          return (
            <button key={k} className={`chip-btn${yearParam === k ? ' is-active' : ''}`} aria-pressed={yearParam === k} onClick={() => setYear(k)}>
              {y.year === null ? 'No date' : y.year}
            </button>
          );
        })}
      </div>

      <section className="kpis kpis-4" aria-label="Totals for the selection">
        <div className="card"><Stat label="Purchases" value={shown.length.toLocaleString()} /></div>
        <div className="card"><Stat label="Bottles" value={totals.bottles.toLocaleString()} /></div>
        <div className="card">
          <Stat label="Spent" value={totals.priced ? formatMoney(totals.spent, currency, 0) : '—'} note={totals.priced < totals.bottles ? `${pluralize(totals.bottles - totals.priced, 'bottle')} ${totals.bottles - totals.priced === 1 ? 'has' : 'have'} no price` : undefined} />
        </div>
        <div className="card"><Stat label="Average per bottle" value={totals.avg !== null ? formatMoney(totals.avg, currency) : '—'} /></div>
      </section>

      {groups.map(([key, list]) => {
        const { bottles, spent, anyPrice } = yearTotals.get(key) ?? { bottles: 0, spent: 0, anyPrice: false };
        return (
          <Card key={key} className="flush">
            <div className="group-head">
              <h2>{key === 'none' ? 'Date unknown' : key}</h2>
              <span className="muted">
                {pluralize(bottles, 'bottle')}
                {anyPrice ? ` · ${formatMoney(spent, currency, 0)}` : ''}
              </span>
            </div>
            <ul className="purchase-list">
              {list.map(({ purchase: p, vintage, bottling, producer }) => (
                <li key={p.id}>
                  <Link to={`/wine/${vintage.id}`}>
                    <span className="pl-main">
                      <span className="pl-title">{wineTitle({ producer, bottling, vintage })}</span>
                      <span className="pl-meta">
                        {formatDate(p.date)}
                        {p.merchant ? ` · ${p.merchant}` : ''}
                      </span>
                    </span>
                    <span className="pl-money">
                      <span>
                        {p.quantity} × {p.unitPrice !== undefined ? formatMoney(p.unitPrice, currency) : '—'}
                      </span>
                      <b>{p.unitPrice !== undefined ? formatMoney(p.unitPrice * p.quantity, currency) : ''}</b>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <ShowMore remaining={moreEntries} onMore={showMoreEntries} onAll={showAllEntries} noun="purchases" />

      {merchants.length > 0 && (
        <Card title="Where you buy" subtitle="Bottles by merchant">
          <RankBars items={merchants.slice(0, 6)} />
        </Card>
      )}
    </>
  );
}
