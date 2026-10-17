import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasSampleData, needsBackup, removeSampleData } from '../../domain/actions';
import { NOT_SET, forecastByYear, purchaseEntries, wineTitle, type WineRow } from '../../domain/inventory';
import { sampleWines } from '../loadSample';
import { formatMoney, pluralize } from '../../domain/text';
import { STATUS_LABEL, STATUS_ORDER, formatWindow, describeStatus, windowOf } from '../../domain/window';
import { useCellar, useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, ConsumeDialog, EmptyNote, PageHead, Stat } from '../components';
import { ColumnChart, RankBars, StackedBar, type SeriesDef } from '../charts';
import { useConfirm } from '../overlays';
import { StatusBadge } from '../status';
import { STATUS_VAR } from '../palette';

const FORECAST_YEARS = 10;
const FORECAST_STATUSES = STATUS_ORDER.filter((s) => s !== 'unknown');

export function Dashboard() {
  const { data, rows, stats, now } = useRows();
  const { apply, replaceAll } = useCellar();
  const confirm = useConfirm();
  const [drinking, setDrinking] = useState<WineRow | null>(null);
  const year = now.getFullYear();
  const currency = data.settings.currency;

  const boughtThisYear = useMemo(() => {
    let bottles = 0;
    let spent = 0;
    for (const e of purchaseEntries(data)) {
      if (e.purchase.date?.startsWith(String(year))) {
        bottles += e.purchase.quantity;
        spent += (e.purchase.unitPrice ?? 0) * e.purchase.quantity;
      }
    }
    return { bottles, spent };
  }, [data, year]);

  const attention = useMemo(
    () =>
      rows
        .filter((r) => r.bottles > 0 && (r.status === 'soon' || r.status === 'past'))
        .sort((a, b) => (a.vintage.drinkTo ?? 9999) - (b.vintage.drinkTo ?? 9999) || a.producer.name.localeCompare(b.producer.name)),
    [rows],
  );

  const forecast = useMemo(() => forecastByYear(rows, year, FORECAST_YEARS, data.settings.drinkSoonYears), [rows, year, data.settings.drinkSoonYears]);

  if (data.vintages.length === 0) {
    return (
      <>
        <PageHead title="Welcome to Cellar Book" subtitle="A clear picture of your cellar: what you own, what you paid, and when to drink it." />
        <Card>
          <div className="welcome">
            <h2>Start your cellar</h2>
            <p>Everything stays on this device. You can add wines one by one, or bring in a spreadsheet or a backup.</p>
            <div className="welcome-actions">
              <Link className="btn btn-primary" to="/wine/new">
                <Icon name="plus" size={18} /> Add your first wine
              </Link>
              <Link className="btn" to="/settings#import">
                <Icon name="upload" size={18} /> Import a spreadsheet or backup
              </Link>
              <button className="btn" onClick={async () => replaceAll(await sampleWines())}>
                Explore with sample wines
              </button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const sample = hasSampleData(data);
  const segments = STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABEL[s], value: stats.byStatus[s], color: STATUS_VAR[s], to: `/cellar?status=${s}` }));
  const series: SeriesDef[] = FORECAST_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], color: STATUS_VAR[s] }));
  const nSoon = stats.byStatus.soon;
  const nPast = stats.byStatus.past;
  const topN = (list: typeof stats.byColour, link: (key: string) => string) =>
    list.slice(0, 6).map((c) => ({ key: c.key, label: c.label, value: c.bottles, to: link(c.key) }));
  const hasLayout = data.locations.length > 0;
  const looseEnds = [
    hasLayout && stats.unplacedBottles > 0 ? { key: 'place', text: `${pluralize(stats.unplacedBottles, 'bottle')} ${stats.unplacedBottles === 1 ? 'has' : 'have'} no place recorded`, to: '/cellar?view=map', cta: 'Put them away' } : null,
    stats.noPhotoWines > 0 ? { key: 'photo', text: `${pluralize(stats.noPhotoWines, 'wine')} ${stats.noPhotoWines === 1 ? 'has' : 'have'} no label photo`, to: '/cellar?view=wines&layout=labels&nophoto=1', cta: 'Add photos' } : null,
    !hasLayout ? { key: 'layout', text: 'Your cellar layout isn’t set up, so bottles have no places yet', to: '/layout', cta: 'Set up layout' } : null,
  ].filter((x): x is { key: string; text: string; to: string; cta: string } => x !== null);

  return (
    <>
      <PageHead title="Your cellar" subtitle={now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />

      {sample && (
        <div className="banner">
          <Icon name="info" />
          <p>
            You’re looking at <strong>sample wines</strong>. Remove them whenever you like — wines you add yourself stay.
          </p>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (await confirm({ title: 'Remove sample wines?', message: 'The demo wines and their purchases are deleted. Anything you added yourself is kept.', confirmLabel: 'Remove samples', danger: true })) {
                apply((d) => ({ ok: true as const, data: removeSampleData(d) }));
              }
            }}
          >
            Remove sample wines
          </button>
        </div>
      )}
      {needsBackup(data, now) && (
        <div className="banner banner-warn">
          <Icon name="alert" />
          <p>
            <strong>Your cellar lives only on this device.</strong> {data.meta.lastBackupAt ? 'It has been a while since your last backup.' : 'You haven’t made a backup yet.'}
          </p>
          <Link className="btn btn-sm" to="/settings#backup">
            Back up now
          </Link>
        </div>
      )}

      {stats.bottles === 0 ? (
        <Card>
          <EmptyNote>
            No bottles in stock right now. <Link to="/wine/new">Add a wine</Link>, or <Link to="/cellar?finished=1">look back at what you’ve enjoyed</Link>.
          </EmptyNote>
        </Card>
      ) : (
        <>
          <section className="kpis" aria-label="Summary">
            <div className="card hero">
              <span className="hero-label">Bottles in your cellar</span>
              <span className="hero-value">{stats.bottles.toLocaleString()}</span>
              <span className="hero-note">
                {pluralize(stats.wines, 'wine')} from {pluralize(stats.producers, 'winery', 'wineries')}
              </span>
            </div>
            <div className="card">
              <Stat
                label="Cost of what’s in stock"
                value={stats.pricedBottles > 0 ? formatMoney(stats.costOfStock, currency, 0) : '—'}
                note={
                  stats.pricedBottles === 0
                    ? 'No prices recorded yet'
                    : stats.unpricedBottles > 0
                      ? `Based on ${stats.pricedBottles} priced bottles · ${stats.unpricedBottles} without a price aren’t counted`
                      : 'Based on what you paid'
                }
              />
            </div>
            <div className="card">
              <Stat
                label={`Bought in ${year}`}
                value={pluralize(boughtThisYear.bottles, 'bottle')}
                note={boughtThisYear.spent > 0 ? `${formatMoney(boughtThisYear.spent, currency, 0)} spent` : boughtThisYear.bottles ? 'No prices recorded' : 'Nothing yet this year'}
              />
            </div>
          </section>

          <Card
            title="Drinking windows"
            subtitle="Bottles by where they are in their window today"
            action={
              <Link className="link-quiet" to="/cellar?view=timeline">
                Timeline <Icon name="chevron" size={16} />
              </Link>
            }
          >
            <StackedBar segments={segments} />
            {stats.byStatus.unknown > 0 && (
              <p className="card-foot">
                <Icon name="info" size={16} /> {pluralize(stats.byStatus.unknown, 'bottle')} {stats.byStatus.unknown === 1 ? 'has' : 'have'} no drinking window yet.{' '}
                <Link to="/cellar?status=unknown">Review them</Link>
              </p>
            )}
          </Card>

          <Card
            title="Drink these first"
            subtitle={
              attention.length === 0 ? undefined : (
                <>
                  {nSoon > 0 && <Link to="/cellar?status=soon">{pluralize(nSoon, 'bottle')} closing soon</Link>}
                  {nSoon > 0 && nPast > 0 && ' · '}
                  {nPast > 0 && <Link to="/cellar?status=past">{pluralize(nPast, 'bottle')} past their window</Link>}
                </>
              )
            }
          >
            {attention.length === 0 ? (
              <EmptyNote>Nothing is about to close its window. Enjoy the wait.</EmptyNote>
            ) : (
              <ul className="plain-list">
                {attention.slice(0, 6).map((r) => (
                  <li key={r.vintage.id} className="attn-row">
                    <Link to={`/wine/${r.vintage.id}`}>
                      <span className="attn-title">{wineTitle(r)}</span>
                      <span className="attn-meta">
                        <StatusBadge status={r.status} short />
                        <span>{formatWindow(windowOf(r.vintage))}</span>
                        <span className="muted">{describeStatus(windowOf(r.vintage), r.status, year)}</span>
                      </span>
                    </Link>
                    <span className="attn-count">{pluralize(r.bottles, 'bottle')}</span>
                    <button className="btn btn-quiet btn-sm" onClick={() => setDrinking(r)} aria-label={`Take a bottle out of ${wineTitle(r)}`}>
                      <Icon name="cellar" size={16} /> Drink
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 6 && (
              <p className="card-foot">
                Showing 6 of {attention.length} wines. <Link to="/cellar?status=soon">See all closing soon</Link>
              </p>
            )}
          </Card>

          <Card title="How your cellar matures" subtitle={`Bottles by drinking-window status each year, if you open none of them`}>
            <ColumnChart
              caption="Bottles by drinking window status, per year"
              series={series}
              showCaps={false}
              data={forecast.map((f, i) => ({ key: String(f.year), label: String(f.year), shortLabel: `’${String(f.year).slice(2)}`, emphasis: i === 0, values: f.counts }))}
            />
            {stats.byStatus.unknown > 0 && <p className="card-foot muted">{pluralize(stats.byStatus.unknown, 'bottle')} without a drinking window aren’t shown.</p>}
          </Card>

          {looseEnds.length > 0 && (
            <Card title="Loose ends" subtitle="Small jobs that make the catalogue complete.">
              <ul className="plain-list">
                {looseEnds.map((l) => (
                  <li key={l.key} className="attn-row">
                    <Link to={l.to}>
                      <span className="attn-title">{l.text}</span>
                    </Link>
                    <Link className="btn btn-sm" to={l.to}>
                      {l.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid-2">
            <Card title="By colour">
              <RankBars items={topN(stats.byColour, (k) => (k === NOT_SET ? '/cellar' : `/cellar?colour=${encodeURIComponent(k)}`))} />
            </Card>
            <Card title="Still or sparkling">
              <RankBars items={topN(stats.byFizz, (k) => `/cellar?fizz=${k}`)} />
            </Card>
            <Card title="By country">
              <RankBars items={topN(stats.byCountry, (k) => `/cellar?country=${encodeURIComponent(k)}`)} />
              {stats.byCountry.length > 6 && <p className="card-foot muted">Top 6 of {stats.byCountry.length} countries.</p>}
            </Card>
            {stats.byGroup.some((g) => g.key !== NOT_SET) && (
              <Card title="By owner family or company">
                <RankBars items={topN(stats.byGroup, (k) => `/cellar?group=${encodeURIComponent(k)}&by=owner`)} />
                {stats.byGroup.length > 6 && <p className="card-foot muted">Top 6 of {stats.byGroup.length}.</p>}
              </Card>
            )}
          </div>
        </>
      )}

      {drinking && <ConsumeDialog row={drinking} onClose={() => setDrinking(null)} />}
    </>
  );
}
