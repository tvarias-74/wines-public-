import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addPurchase, deleteConsumption, deletePurchase, deleteWine, updatePurchase, type FieldErrors } from '../../domain/actions';
import { wineTitle, type WineRow } from '../../domain/inventory';
import { parseNumber } from '../../domain/portability';
import { REMOVAL_REASON_LABEL, WINE_TYPE_LABEL, type Purchase } from '../../domain/types';
import { formatDate, formatMoney, formatYear, isValidDate, pluralize, sizeLabel, toIsoDate } from '../../domain/text';
import { describeStatus, formatPeak, formatWindow, windowOf } from '../../domain/window';
import { useCellar, useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, ConsumeDialog, DateField, EmptyNote, Field, PageHead, Stepper } from '../components';
import { grapesLabel } from '../format';
import { Modal, useConfirm, useToast } from '../overlays';
import { StatusBadge, WindowTrack, domainFor, yearPosition } from '../status';

export function WineDetail() {
  const { id } = useParams();
  const { data, rows, now } = useRows();
  const { apply } = useCellar();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [drinking, setDrinking] = useState(false);
  const [purchaseDialog, setPurchaseDialog] = useState<Purchase | 'new' | null>(null);

  const row = rows.find((r) => r.vintage.id === id);
  if (!row) {
    return (
      <>
        <PageHead title="Wine not found" />
        <Card>
          <EmptyNote>
            This wine isn’t in your cellar (it may have been deleted). <Link to="/cellar">Back to the cellar</Link>
          </EmptyNote>
        </Card>
      </>
    );
  }

  const { vintage, bottling, producer } = row;
  const currency = data.settings.currency;
  const year = now.getFullYear();
  const w = windowOf(vintage);
  const peak = formatPeak(w);
  const hasWindow = vintage.drinkFrom !== undefined || vintage.drinkTo !== undefined;
  const domain = domainFor(w, yearPosition(now));
  const purchases = data.purchases.filter((p) => p.vintageId === vintage.id).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const consumptions = data.consumptions.filter((c) => c.vintageId === vintage.id).sort((a, b) => b.date.localeCompare(a.date));
  const siblings = rows.filter((r) => r.bottling.id === bottling.id && r.vintage.id !== vintage.id).sort((a, b) => (b.vintage.year ?? 0) - (a.vintage.year ?? 0));

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this wine?',
      message: (
        <>
          <strong>{wineTitle(row)}</strong> will be deleted together with its {pluralize(purchases.length, 'purchase')} and {pluralize(consumptions.length, 'tasting/removal')}. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete wine',
      danger: true,
    });
    if (!ok) return;
    apply((d) => ({ ok: true as const, data: deleteWine(d, vintage.id) }));
    toast(`Deleted ${wineTitle(row)}`);
    navigate('/cellar', { replace: true });
  };

  const removePurchase = async (p: Purchase) => {
    const ok = await confirm({
      title: 'Remove this purchase?',
      message: `${pluralize(p.quantity, 'bottle')}${p.date ? ` bought ${formatDate(p.date)}` : ''} will be removed from the record.`,
      confirmLabel: 'Remove purchase',
      danger: true,
    });
    if (!ok) return;
    const r = apply((d) => deletePurchase(d, p.id));
    if (!r.ok) toast(r.error, { tone: 'error' });
  };

  const undoConsumption = (cid: string) => apply((d) => ({ ok: true as const, data: deleteConsumption(d, cid) }));

  return (
    <>
      <Link className="back-link" to="/cellar">
        <Icon name="back" size={18} /> Cellar
      </Link>
      <PageHead
        title={`${bottling.name} ${formatYear(vintage.year)}`}
        subtitle={
          <>
            <Link to={`/cellar?q=${encodeURIComponent(producer.name)}`}>{producer.name}</Link>
          </>
        }
        actions={
          <>
            <Link className="btn" to={`/wine/${vintage.id}/edit`}>
              <Icon name="edit" size={18} /> Edit
            </Link>
            <button className="btn btn-danger-quiet" onClick={remove}>
              <Icon name="trash" size={18} /> Delete
            </button>
          </>
        }
      />
      <div className="tags">
        <span className="chip">{WINE_TYPE_LABEL[bottling.type]}</span>
        {vintage.sizeMl !== 750 && <span className="chip">{sizeLabel(vintage.sizeMl)}</span>}
        {row.bottles > 0 ? <StatusBadge status={row.status} /> : <span className="badge st-finished">Finished</span>}
      </div>

      <div className="detail-grid">
        <Card className="stock">
          <span className="hero-label">In the cellar</span>
          <span className="hero-value">{row.bottles}</span>
          <span className="hero-note">
            {pluralize(row.purchased, 'bottle')} bought · {row.consumed} taken out
          </span>
          <div className="stock-actions">
            <button className="btn btn-primary" onClick={() => setDrinking(true)} disabled={row.bottles === 0}>
              <Icon name="cellar" size={18} /> Drink a bottle
            </button>
            <button className="btn" onClick={() => setPurchaseDialog('new')}>
              <Icon name="plus" size={18} /> Add bottles
            </button>
          </div>
        </Card>

        <Card title="Drinking window" action={<Link className="link-quiet" to={`/wine/${vintage.id}/edit#window`}>{hasWindow ? 'Change' : 'Set window'}</Link>}>
          {hasWindow ? (
            <>
              <div className="window-figure">
                <span className="window-years">{formatWindow(w)}</span>
                {peak && <span className="window-peak">peak {peak}</span>}
              </div>
              <WindowTrack window={w} status={row.status} domain={domain} nowPos={yearPosition(now)} />
              <div className="track-scale" aria-hidden="true">
                <span>{domain.start}</span>
                <span>{domain.end}</span>
              </div>
              <p className="window-note">
                {row.bottles > 0 && describeStatus(w, row.status, year) ? `${describeStatus(w, row.status, year)}. ` : ''}
                {vintage.windowSource === 'estimate' ? 'This is a rule-of-thumb estimate — adjust it with your own notes or a critic’s guidance.' : ''}
              </p>
            </>
          ) : (
            <EmptyNote>
              No drinking window yet. <Link to={`/wine/${vintage.id}/edit#window`}>Set one</Link> to see when to open it.
            </EmptyNote>
          )}
        </Card>
      </div>

      <Card title="About this wine">
        <dl className="facts">
          <div>
            <dt>Producer</dt>
            <dd>{producer.name}</dd>
          </div>
          <div>
            <dt>Bottling</dt>
            <dd>{bottling.name}</dd>
          </div>
          <div>
            <dt>Vintage</dt>
            <dd>{vintage.year === null ? 'Non-vintage' : vintage.year}</dd>
          </div>
          {(bottling.appellation || bottling.region || bottling.country) && (
            <div>
              <dt>Origin</dt>
              <dd>{[bottling.appellation, bottling.region, bottling.country].filter(Boolean).join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>Varieties</dt>
            <dd>{bottling.grapes.length ? grapesLabel(bottling.grapes) : <span className="muted">Not recorded</span>}</dd>
          </div>
          {vintage.location && (
            <div>
              <dt>Stored at</dt>
              <dd>{vintage.location}</dd>
            </div>
          )}
          {vintage.notes && (
            <div className="span-2">
              <dt>Notes</dt>
              <dd className="pre">{vintage.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <PurchasesCard row={row} purchases={purchases} currency={currency} onAdd={() => setPurchaseDialog('new')} onEdit={setPurchaseDialog} onRemove={removePurchase} />

      <Card title="Taken out of the cellar" subtitle={consumptions.length ? undefined : 'Nothing yet'}>
        {consumptions.length > 0 && (
          <ul className="ledger">
            {consumptions.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>
                    {formatDate(c.date)} · {pluralize(c.quantity, 'bottle')}
                  </strong>
                  <span className="muted"> · {REMOVAL_REASON_LABEL[c.reason]}</span>
                  {c.notes && <p className="ledger-note">{c.notes}</p>}
                </div>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={async () => {
                    if (await confirm({ title: 'Put the bottles back?', message: `${pluralize(c.quantity, 'bottle')} will be added back to the cellar.`, confirmLabel: 'Put back' })) undoConsumption(c.id);
                  }}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {siblings.length > 0 && (
        <Card title={`Other vintages of ${bottling.name}`}>
          <ul className="plain-list">
            {siblings.map((s) => (
              <li key={s.vintage.id} className="attn-row">
                <Link to={`/wine/${s.vintage.id}`}>
                  <span className="attn-title">{formatYear(s.vintage.year)}</span>
                  <span className="attn-meta">{s.bottles > 0 ? <StatusBadge status={s.status} short /> : <span className="badge st-finished">Finished</span>}<span>{formatWindow(windowOf(s.vintage))}</span></span>
                </Link>
                <span className="attn-count">{pluralize(s.bottles, 'bottle')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drinking && <ConsumeDialog row={row} onClose={() => setDrinking(false)} />}
      {purchaseDialog && <PurchaseDialog vintageId={vintage.id} purchase={purchaseDialog === 'new' ? null : purchaseDialog} currency={currency} onClose={() => setPurchaseDialog(null)} />}
    </>
  );
}

function PurchasesCard({ row, purchases, currency, onAdd, onEdit, onRemove }: { row: WineRow; purchases: Purchase[]; currency: string; onAdd: () => void; onEdit: (p: Purchase) => void; onRemove: (p: Purchase) => void }) {
  return (
    <Card
      title="Purchases"
      subtitle={
        row.avgPrice !== null ? (
          <>
            {formatMoney(row.spent, currency)} for {pluralize(row.pricedBottles, 'priced bottle')} · average {formatMoney(row.avgPrice, currency)} per bottle
          </>
        ) : purchases.length ? (
          'No prices recorded'
        ) : undefined
      }
      action={
        <button className="btn btn-sm" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add
        </button>
      }
    >
      {purchases.length === 0 ? (
        <EmptyNote>No purchases recorded.</EmptyNote>
      ) : (
        <ul className="ledger">
          {purchases.map((p) => (
            <li key={p.id}>
              <div>
                <strong>
                  {formatDate(p.date)} · {pluralize(p.quantity, 'bottle')}
                </strong>
                <span className="muted">
                  {' '}
                  · {p.unitPrice !== undefined ? `${formatMoney(p.unitPrice, currency)} each (${formatMoney(p.unitPrice * p.quantity, currency)})` : 'price not recorded'}
                  {p.merchant ? ` · ${p.merchant}` : ''}
                </span>
                {p.notes && <p className="ledger-note">{p.notes}</p>}
              </div>
              <span className="ledger-actions">
                <button className="btn btn-quiet btn-sm" onClick={() => onEdit(p)} aria-label="Edit purchase">
                  <Icon name="edit" size={16} />
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => onRemove(p)} aria-label="Remove purchase">
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PurchaseDialog({ vintageId, purchase, currency, onClose }: { vintageId: string; purchase: Purchase | null; currency: string; onClose: () => void }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [quantity, setQuantity] = useState(purchase?.quantity ?? 1);
  const [price, setPrice] = useState(purchase?.unitPrice !== undefined ? String(purchase.unitPrice) : '');
  const [date, setDate] = useState(purchase ? (purchase.date ?? '') : toIsoDate(new Date()));
  const [merchant, setMerchant] = useState(purchase?.merchant ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const priceValue = price.trim() === '' ? undefined : (parseNumber(price) ?? Number.NaN);
    const dateValue = date.trim() === '' ? undefined : date.trim();
    const input = { quantity, unitPrice: priceValue, date: dateValue, merchant, notes };
    if (dateValue !== undefined && !isValidDate(dateValue)) {
      setErrors({ date: 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)' });
      return;
    }
    const r = apply((d) => (purchase ? updatePurchase(d, purchase.id, input) : addPurchase(d, vintageId, input)));
    if (!r.ok) {
      setErrors(r.fieldErrors ?? { quantity: r.error });
      return;
    }
    toast(purchase ? 'Purchase updated' : `Added ${pluralize(quantity, 'bottle')}`);
    onClose();
  };

  return (
    <Modal
      title={purchase ? 'Edit purchase' : 'Add bottles'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {purchase ? 'Save' : 'Add to cellar'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Bottles" error={errors.quantity}>
          {() => <Stepper label="Bottles" value={quantity} min={1} onChange={setQuantity} />}
        </Field>
        <Field label={`Price per bottle (${currency})`} error={errors.unitPrice} hint="Leave empty if you don’t know">
          {(id, d) => <input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" aria-describedby={d} />}
        </Field>
        <Field label="Date bought" error={errors.date}>
          {(id, d) => <DateField id={id} value={date} onChange={setDate} describedBy={d} />}
        </Field>
        <Field label="Bought from">
          {(id) => <input id={id} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant, shop, auction, gift…" autoCapitalize="words" />}
        </Field>
        <Field label="Notes (optional)" className="span-2">
          {(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
