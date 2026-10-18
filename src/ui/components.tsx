import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { WineRow } from '../domain/inventory';
import { wineTitle } from '../domain/inventory';
import { formatMoney, formatYear, pluralize, sizeBadge } from '../domain/text';
import { describeStatus, formatWindow, windowOf } from '../domain/window';
import { Icon } from './Icon';
import { LabelImage } from './LabelImage';
import { StatusBadge } from './status';
import { placementsLabel } from './format';

export { DateField, Field, Stepper } from './forms';
export { ConsumeDialog } from './Tasting';

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

export function Card({ title, subtitle, action, children, className, id }: { title?: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card${className ? ` ${className}` : ''}`}>
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

export function RatingBadge({ rating, count }: { rating: number; count: number }) {
  return (
    <span className="rating-badge" title={`Your rating, averaged over ${pluralize(count, 'tasting')}`}>
      <Icon name="star" size={13} />
      {rating % 1 ? rating.toFixed(1) : rating}
    </span>
  );
}

/**
 * One vintage in a list. `showTitle` adds the producer and bottling (and the label thumbnail) for flat
 * lists; the producer tree already shows them above. `hasLayout` says whether the cellar layout is in
 * use, so "where is it" is only shown when it means something.
 */
export function WineRowItem({
  row,
  showTitle,
  onDrink,
  currency,
  nowYear,
  hasLayout,
}: {
  row: WineRow;
  showTitle?: boolean;
  onDrink: (row: WineRow) => void;
  currency: string;
  nowYear: number;
  hasLayout?: boolean;
}) {
  const w = windowOf(row.vintage);
  const finished = row.bottles === 0;
  const detail = finished ? '' : describeStatus(w, row.status, nowYear);
  const badge = sizeBadge(row.vintage.sizeMl);
  const where = !finished && hasLayout ? placementsLabel(row) : null;
  const photo = row.vintage.images?.front ?? row.vintage.images?.back;
  return (
    <div className={`wine-row${finished ? ' is-finished' : ''}`}>
      {showTitle && (
        <Link className="wr-thumb" to={`/wine/${row.vintage.id}`} tabIndex={-1} aria-hidden="true">
          <LabelImage id={photo} alt={wineTitle(row)} />
        </Link>
      )}
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
          {row.rating !== null && <RatingBadge rating={row.rating} count={row.ratingCount} />}
        </span>
        {hasLayout && !finished && (
          <span className={`wr-where${where ? '' : ' is-unplaced'}`}>
            <Icon name="pin" size={13} /> {where ?? 'No place recorded'}
            {where && row.unplaced > 0 && <span className="muted"> · {row.unplaced} not placed</span>}
          </span>
        )}
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
