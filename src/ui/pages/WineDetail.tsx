import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addPurchase,
  addReview,
  deleteConsumption,
  deletePurchase,
  deleteReview,
  deleteWine,
  safeUrl,
  setVintageImage,
  setVintageWindow,
  updatePurchase,
  updateReview,
  type FieldErrors,
  type PlacementInput,
  type ReviewInput,
} from '../../domain/actions';
import { tastingEntries, wineTitle, type WineRow } from '../../domain/inventory';
import { parseNumber } from '../../domain/portability';
import { BOX_MATERIAL_LABEL, REMOVAL_REASON_LABEL, REVIEW_SOURCES, REVIEW_SOURCE_LABEL, REVIEW_SOURCE_SCALE, type Consumption, type Purchase, type Review, type ReviewSource } from '../../domain/types';
import { bottlingKindLabel, formatDate, formatMoney, formatYear, isValidDate, pluralize, sizeLabel, toIsoDate } from '../../domain/text';
import { describeStatus, formatPeak, formatWindow, windowOf } from '../../domain/window';
import { useCellar, useRows } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, ConsumeDialog, DateField, EmptyNote, Field, PageHead, RatingBadge, Stepper } from '../components';
import { grapesLabel, reviewSearches } from '../format';
import { PhotoSlot, discardImage } from '../LabelImage';
import { Modal, useConfirm, useToast } from '../overlays';
import { MoveDialog, PlaceDialog, PlacementPicker } from '../Placement';
import { StatusBadge, WindowTrack, domainFor, yearPosition } from '../status';
import { TastingDialog } from '../Tasting';

export function WineDetail() {
  const { id } = useParams();
  const { data, rows, now } = useRows();
  const { apply } = useCellar();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [drinking, setDrinking] = useState<{ locationId?: string } | null>(null);
  const [purchaseDialog, setPurchaseDialog] = useState<Purchase | 'new' | null>(null);
  const [reviewDialog, setReviewDialog] = useState<Review | 'new' | null>(null);
  const [tasting, setTasting] = useState<Consumption | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

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

  const { vintage, bottling, producer, group } = row;
  const currency = data.settings.currency;
  const year = now.getFullYear();
  const w = windowOf(vintage);
  const peak = formatPeak(w);
  const hasWindow = vintage.drinkFrom !== undefined || vintage.drinkTo !== undefined;
  const domain = domainFor(w, yearPosition(now));
  const purchases = data.purchases.filter((p) => p.vintageId === vintage.id).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const history = tastingEntries(data, vintage.id);
  const reviews = data.reviews.filter((r) => r.vintageId === vintage.id);
  const siblings = rows.filter((r) => r.bottling.id === bottling.id && r.vintage.id !== vintage.id).sort((a, b) => (b.vintage.year ?? 0) - (a.vintage.year ?? 0));
  const hasLayout = data.locations.length > 0;
  const kind = bottlingKindLabel(bottling);
  const movingFrom = moving ? data.locations.find((l) => l.id === moving) : undefined;

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this wine?',
      message: (
        <>
          <strong>{wineTitle(row)}</strong> will be deleted together with its {pluralize(purchases.length, 'purchase')}, {pluralize(history.length, 'tasting/removal')} and {pluralize(reviews.length, 'review')}. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete wine',
      danger: true,
    });
    if (!ok) return;
    const photos = [vintage.images?.front, vintage.images?.back];
    apply((d) => ({ ok: true as const, data: deleteWine(d, vintage.id) }));
    photos.forEach((p) => void discardImage(p));
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

  const undoTasting = async (c: Consumption) => {
    const ok = await confirm({ title: 'Put the bottles back?', message: `${pluralize(c.quantity, 'bottle')} will be added back to the cellar${c.locationId ? ', to the place they came from if there is room' : ''}, and this tasting is removed.`, confirmLabel: 'Put back' });
    if (ok) apply((d) => ({ ok: true as const, data: deleteConsumption(d, c.id) }));
  };

  const setPhoto = (side: 'front' | 'back', newId: string | undefined) => {
    const old = vintage.images?.[side];
    apply((d) => ({ ok: true as const, data: setVintageImage(d, vintage.id, side, newId) }));
    if (old && old !== newId) void discardImage(old);
  };

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
            {group && (
              <>
                {' · '}
                <Link to={`/cellar?group=${group.id}`}>{group.name}</Link>
              </>
            )}
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
        {kind && <span className="chip">{kind}</span>}
        {vintage.sizeMl !== 750 && <span className="chip">{sizeLabel(vintage.sizeMl)}</span>}
        {row.bottles > 0 ? <StatusBadge status={row.status} /> : <span className="badge st-finished">Finished</span>}
        {row.rating !== null && <RatingBadge rating={row.rating} count={row.ratingCount} />}
      </div>

      <div className="detail-grid">
        <Card className="stock">
          <span className="hero-label">In the cellar</span>
          <span className="hero-value">{row.bottles}</span>
          <span className="hero-note">
            {pluralize(row.purchased, 'bottle')} bought · {row.consumed} taken out
          </span>
          <div className="stock-actions">
            <button className="btn btn-primary" onClick={() => setDrinking({})} disabled={row.bottles === 0}>
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

      <Card title="Label" subtitle="Photograph the front and back of the bottle, at purchase or when you put it away.">
        <div className="photo-pair">
          <PhotoSlot label="Front label" imageId={vintage.images?.front} onChange={(i) => setPhoto('front', i)} onError={(m) => toast(m, { tone: 'error' })} />
          <PhotoSlot label="Back label" imageId={vintage.images?.back} onChange={(i) => setPhoto('back', i)} onError={(m) => toast(m, { tone: 'error' })} />
        </div>
      </Card>

      {(hasLayout || row.placements.length > 0) && (
        <Card
          title="Where it is"
          subtitle={row.bottles > 0 ? (row.unplaced === 0 && row.placements.length ? 'Every bottle has a place.' : undefined) : 'No bottles left.'}
          action={
            hasLayout ? (
              <Link className="link-quiet" to="/cellar?view=map">
                Cellar map <Icon name="chevron" size={16} />
              </Link>
            ) : undefined
          }
        >
          {row.placements.length > 0 && (
            <ul className="ledger">
              {row.placements.map((p) => (
                <li key={p.location.id}>
                  <div>
                    <Link to={`/cellar?view=wines&loc=${p.location.id}`}>
                      <strong>{p.location.name}</strong>
                    </Link>
                    <span className="muted">
                      {' '}
                      · {pluralize(p.quantity, 'bottle')}
                      {p.location.kind === 'box' && p.location.material ? ` · ${BOX_MATERIAL_LABEL[p.location.material]}` : ''}
                    </span>
                  </div>
                  <span className="ledger-actions">
                    <button className="btn btn-quiet btn-sm" onClick={() => setMoving(p.location.id)}>
                      Move
                    </button>
                    <button className="btn btn-quiet btn-sm" onClick={() => setDrinking({ locationId: p.location.id })}>
                      Drink
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {row.bottles > 0 && row.unplaced > 0 && hasLayout && (
            <p className="card-foot">
              <Icon name="pin" size={16} /> {pluralize(row.unplaced, 'bottle')} {row.unplaced === 1 ? 'has' : 'have'} no place recorded.
              <button className="btn btn-sm" onClick={() => setPlacing(true)}>
                Put away…
              </button>
            </p>
          )}
          {!hasLayout && (
            <EmptyNote>
              Bottles aren’t assigned to places yet. <Link to="/layout">Set up your cellar layout</Link> to track divisions and boxes.
            </EmptyNote>
          )}
        </Card>
      )}

      <Card title="About this wine">
        <dl className="facts">
          <div>
            <dt>Winery</dt>
            <dd>{producer.name}</dd>
          </div>
          {group && (
            <div>
              <dt>Owned by</dt>
              <dd>
                <Link to={`/cellar?group=${group.id}`}>{group.name}</Link>
              </dd>
            </div>
          )}
          <div>
            <dt>Bottling</dt>
            <dd>{bottling.name}</dd>
          </div>
          <div>
            <dt>Vintage</dt>
            <dd>{vintage.year === null ? 'Non-vintage' : vintage.year}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{kind || <span className="muted">Not recorded</span>}</dd>
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
          {vintage.notes && (
            <div className="span-2">
              <dt>Notes</dt>
              <dd className="pre">{vintage.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <PurchasesCard row={row} purchases={purchases} currency={currency} onAdd={() => setPurchaseDialog('new')} onEdit={setPurchaseDialog} onRemove={removePurchase} />

      <Card title="Tastings and history" subtitle={history.length ? 'Bottles taken out, with your rating and impressions.' : 'Nothing taken out yet.'}>
        {history.length > 0 && (
          <ul className="ledger tastings">
            {history.map(({ consumption: c, impressions, location }) => (
              <li key={c.id}>
                <div className="tasting-main">
                  <div>
                    <strong>
                      {formatDate(c.date)} · {pluralize(c.quantity, 'bottle')}
                    </strong>
                    <span className="muted">
                      {' '}
                      · {REMOVAL_REASON_LABEL[c.reason]}
                      {location ? ` · from ${location.name}` : ''}
                    </span>
                    {c.rating !== undefined && (
                      <span className="tasting-score">
                        <Icon name="star" size={14} /> {c.rating % 1 ? c.rating.toFixed(1) : c.rating}
                        <small>/20</small>
                      </span>
                    )}
                  </div>
                  {impressions.length > 0 && (
                    <ul className="tags-list">
                      {impressions.map((label) => (
                        <li key={label} className="word">
                          {label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.notes && <p className="ledger-note">{c.notes}</p>}
                </div>
                <span className="ledger-actions">
                  <button className="btn btn-quiet btn-sm" onClick={() => setTasting(c)}>
                    {c.rating === undefined && !c.impressions?.length && !c.notes ? 'Add notes' : 'Edit'}
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => undoTasting(c)}>
                    Undo
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReviewsCard
        row={row}
        reviews={reviews}
        onAdd={() => setReviewDialog('new')}
        onEdit={setReviewDialog}
        onDelete={async (r) => {
          if (await confirm({ title: 'Delete this review?', message: 'It is removed from this wine.', confirmLabel: 'Delete', danger: true })) apply((d) => ({ ok: true as const, data: deleteReview(d, r.id) }));
        }}
        onUseWindow={async (r) => {
          const next = { drinkFrom: r.drinkFrom, drinkTo: r.drinkTo };
          if (hasWindow && !(await confirm({ title: 'Replace the drinking window?', message: `Your window ${formatWindow(w)} will become ${formatWindow(next)}.`, confirmLabel: 'Use the critic’s window' }))) return;
          const res = apply((d) => setVintageWindow(d, vintage.id, next));
          toast(res.ok ? `Drinking window set to ${formatWindow(next)}` : res.error, res.ok ? undefined : { tone: 'error' });
        }}
      />

      {siblings.length > 0 && (
        <Card title={`Other vintages of ${bottling.name}`}>
          <ul className="plain-list">
            {siblings.map((s) => (
              <li key={s.vintage.id} className="attn-row">
                <Link to={`/wine/${s.vintage.id}`}>
                  <span className="attn-title">{formatYear(s.vintage.year)}</span>
                  <span className="attn-meta">
                    {s.bottles > 0 ? <StatusBadge status={s.status} short /> : <span className="badge st-finished">Finished</span>}
                    <span>{formatWindow(windowOf(s.vintage))}</span>
                  </span>
                </Link>
                <span className="attn-count">{pluralize(s.bottles, 'bottle')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drinking && <ConsumeDialog row={row} presetLocationId={drinking.locationId} onClose={() => setDrinking(null)} />}
      {purchaseDialog && <PurchaseDialog row={row} purchase={purchaseDialog === 'new' ? null : purchaseDialog} currency={currency} onClose={() => setPurchaseDialog(null)} />}
      {reviewDialog && <ReviewDialog vintageId={vintage.id} review={reviewDialog === 'new' ? null : reviewDialog} onClose={() => setReviewDialog(null)} />}
      {tasting && <TastingDialog consumption={tasting} title={wineTitle(row)} onClose={() => setTasting(null)} />}
      {movingFrom && <MoveDialog row={row} from={movingFrom} onClose={() => setMoving(null)} />}
      {placing && <PlaceDialog row={row} onClose={() => setPlacing(false)} />}
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

function ReviewsCard({
  row,
  reviews,
  onAdd,
  onEdit,
  onDelete,
  onUseWindow,
}: {
  row: WineRow;
  reviews: Review[];
  onAdd: () => void;
  onEdit: (r: Review) => void;
  onDelete: (r: Review) => void;
  onUseWindow: (r: Review) => void;
}) {
  const searches = reviewSearches(row);
  return (
    <Card
      title="Reviews"
      subtitle="What critics and other drinkers say. Record the score and a few words, with a link back to the source."
      action={
        <button className="btn btn-sm" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add
        </button>
      }
    >
      <div className="find-reviews">
        <span className="muted">Look it up:</span>
        {searches.map((s) => (
          <a key={s.label} className="btn btn-sm" href={s.url} target="_blank" rel="noopener noreferrer">
            {s.label} <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      <p className="card-sub review-note">These open a search for this wine on each site. Cellar Book can’t fetch the reviews itself: Vivino shares no public data, and Wine Advocate and JancisRobinson.com are paid services. Add what you find here.</p>
      {reviews.length === 0 ? (
        <EmptyNote>No reviews recorded yet.</EmptyNote>
      ) : (
        <ul className="ledger reviews">
          {reviews.map((r) => {
            const link = safeUrl(r.url);
            const who = r.source === 'other' ? (r.sourceName ?? 'Other') : REVIEW_SOURCE_LABEL[r.source];
            return (
              <li key={r.id}>
                <div className="tasting-main">
                  <div>
                    <strong>{who}</strong>
                    {r.reviewer && r.reviewer !== who && <span className="muted"> · {r.reviewer}</span>}
                    {r.score !== undefined && (
                      <span className="tasting-score">
                        {r.score}
                        <small>/{r.scale ?? REVIEW_SOURCE_SCALE[r.source]}</small>
                      </span>
                    )}
                    {r.date && <span className="muted"> · {formatDate(r.date)}</span>}
                  </div>
                  {r.text && <p className="ledger-note">{r.text}</p>}
                  {(r.drinkFrom !== undefined || r.drinkTo !== undefined) && (
                    <p className="ledger-note">
                      Drink {formatWindow({ drinkFrom: r.drinkFrom, drinkTo: r.drinkTo })}{' '}
                      <button className="btn btn-quiet btn-sm" onClick={() => onUseWindow(r)}>
                        Use as my window
                      </button>
                    </p>
                  )}
                  {link && (
                    <p className="ledger-note">
                      <a href={link} target="_blank" rel="noopener noreferrer">
                        Open the review <Icon name="external" size={13} />
                      </a>
                    </p>
                  )}
                </div>
                <span className="ledger-actions">
                  <button className="btn btn-quiet btn-sm" onClick={() => onEdit(r)} aria-label="Edit review">
                    <Icon name="edit" size={16} />
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => onDelete(r)} aria-label="Delete review">
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PurchaseDialog({ row, purchase, currency, onClose }: { row: WineRow; purchase: Purchase | null; currency: string; onClose: () => void }) {
  const { data, apply } = useCellar();
  const toast = useToast();
  const vintageId = row.vintage.id;
  const [quantity, setQuantity] = useState(purchase?.quantity ?? 1);
  const [price, setPrice] = useState(purchase?.unitPrice !== undefined ? String(purchase.unitPrice) : '');
  const [date, setDate] = useState(purchase ? (purchase.date ?? '') : toIsoDate(new Date()));
  const [merchant, setMerchant] = useState(purchase?.merchant ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [plan, setPlan] = useState<PlacementInput[]>([]);
  const [planProblem, setPlanProblem] = useState<string | null>(null);

  const submit = () => {
    const priceValue = price.trim() === '' ? undefined : (parseNumber(price) ?? Number.NaN);
    const dateValue = date.trim() === '' ? undefined : date.trim();
    const input = { quantity, unitPrice: priceValue, date: dateValue, merchant, notes };
    if (dateValue !== undefined && !isValidDate(dateValue)) {
      setErrors({ date: 'Use YYYY-MM-DD (or just YYYY-MM or YYYY)' });
      return;
    }
    if (planProblem) {
      setErrors({ placements: planProblem });
      return;
    }
    const r = apply((d) => (purchase ? updatePurchase(d, purchase.id, input) : addPurchase(d, vintageId, input, plan)));
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
      wide
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
          {(id, d) => <Stepper id={id} describedBy={d} label="Bottles" value={quantity} min={1} onChange={setQuantity} />}
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
        {!purchase && <PlacementPicker data={data} quantity={Number.isFinite(quantity) ? quantity : 0} vintageId={vintageId} onChange={(p, pr) => { setPlan(p); setPlanProblem(pr); }} />}
        {errors.placements && <p className="field-error span-2">{errors.placements}</p>}
        <Field label="Notes (optional)" className="span-2">
          {(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function ReviewDialog({ vintageId, review, onClose }: { vintageId: string; review: Review | null; onClose: () => void }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [source, setSource] = useState<ReviewSource>(review?.source ?? 'parker');
  const [sourceName, setSourceName] = useState(review?.sourceName ?? '');
  const [score, setScore] = useState(review?.score !== undefined ? String(review.score) : '');
  const [scale, setScale] = useState(String(review?.scale ?? REVIEW_SOURCE_SCALE[review?.source ?? 'parker']));
  const [reviewer, setReviewer] = useState(review?.reviewer ?? '');
  const [date, setDate] = useState(review?.date ?? '');
  const [url, setUrl] = useState(review?.url ?? '');
  const [text, setText] = useState(review?.text ?? '');
  const [from, setFrom] = useState(review?.drinkFrom !== undefined ? String(review.drinkFrom) : '');
  const [to, setTo] = useState(review?.drinkTo !== undefined ? String(review.drinkTo) : '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const pickSource = (s: ReviewSource) => {
    setSource(s);
    setScale(String(REVIEW_SOURCE_SCALE[s]));
  };

  const submit = () => {
    const input: ReviewInput = {
      source,
      sourceName,
      score: score.trim() === '' ? undefined : (parseNumber(score) ?? Number.NaN),
      scale: Number(scale),
      reviewer,
      text,
      date: date.trim() || undefined,
      url,
      drinkFrom: from.trim() ? Number(from) : undefined,
      drinkTo: to.trim() ? Number(to) : undefined,
    };
    const r = apply((d) => (review ? updateReview(d, review.id, input) : addReview(d, vintageId, input)));
    if (!r.ok) return setErrors(r.fieldErrors ?? { score: r.error });
    toast(review ? 'Review updated' : 'Review added');
    onClose();
  };

  return (
    <Modal
      title={review ? 'Edit review' : 'Add a review'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {review ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Source" error={errors.source} className={source === 'other' ? undefined : 'span-2'}>
          {(id) => (
            <select id={id} value={source} onChange={(e) => pickSource(e.target.value as ReviewSource)}>
              {REVIEW_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {REVIEW_SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {source === 'other' && (
          <Field label="Who?" error={errors.sourceName}>
            {(id, d) => <input id={id} value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="e.g. Decanter" aria-describedby={d} />}
          </Field>
        )}
        <Field label="Score" error={errors.score}>
          {(id, d) => <input id={id} inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} placeholder={source === 'vivino' ? '4.3' : source === 'robinson' ? '17.5' : '95'} aria-describedby={d} />}
        </Field>
        <Field label="Out of" error={errors.scale} hint={source === 'other' ? 'The top of their scale' : undefined}>
          {(id, d) => <input id={id} inputMode="decimal" value={scale} onChange={(e) => setScale(e.target.value)} disabled={source !== 'other'} aria-describedby={d} />}
        </Field>
        <Field label="Reviewer (optional)">{(id) => <input id={id} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. Jancis Robinson, Lisa Perrotti-Brown" />}</Field>
        <Field label="Date (optional)" error={errors.date}>
          {(id, d) => <input id={id} value={date} onChange={(e) => setDate(e.target.value)} placeholder="YYYY, YYYY-MM or YYYY-MM-DD" aria-describedby={d} />}
        </Field>
        <Field label="Link to the review (optional)" error={errors.url} className="span-2">
          {(id, d) => <input id={id} inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-describedby={d} autoCapitalize="none" />}
        </Field>
        <Field label="Their drinking window: from" error={errors.drinkFrom}>
          {(id, d) => <input id={id} inputMode="numeric" maxLength={4} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Year" aria-describedby={d} />}
        </Field>
        <Field label="…until" error={errors.drinkTo}>
          {(id, d) => <input id={id} inputMode="numeric" maxLength={4} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Year" aria-describedby={d} />}
        </Field>
        <Field label="Their words (short quote or your summary)" className="span-2">
          {(id) => <textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

