import { useState } from 'react';
import { addBarcode, removeBarcode } from '../domain/actions';
import { formatBarcode } from '../domain/barcode';
import { useCellar } from '../storage/store';
import { Icon } from './Icon';
import { useToast } from './overlays';
import { ScanDialog } from './Scan';

/** A wine's barcodes, shared by all its vintages: scan or type one to add it, remove one with Undo. */
export function BarcodeFact({ bottlingId, codes }: { bottlingId: string; codes: string[] }) {
  const { apply } = useCellar();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);

  const add = (code: string) => {
    const r = apply((d) => addBarcode(d, bottlingId, code));
    if (!r.ok) return toast(r.error, { tone: 'error' });
    if (!r.added) return toast('That barcode is already saved on this wine.');
    toast(`Barcode saved. Scanning this bottle will now find it.${r.alsoOn.length ? ` It is also saved on ${r.alsoOn.map((b) => b.name).join(', ')}, so a scan will offer both.` : ''}`);
  };

  const remove = (code: string) => {
    apply((d) => ({ ok: true as const, data: removeBarcode(d, bottlingId, code) }));
    toast('Barcode removed', { action: { label: 'Undo', onClick: () => apply((d) => addBarcode(d, bottlingId, code)) } });
  };

  return (
    <div className="span-2">
      <dt>Barcode</dt>
      <dd className="barcode-fact">
        {codes.length === 0 ? (
          <span className="muted">None yet. Add one and scanning the bottle will find this wine.</span>
        ) : (
          <ul className="tags-list" aria-label="Barcodes">
            {codes.map((c) => (
              <li key={c}>
                <span className="word mono">{formatBarcode(c)}</span>
                <button type="button" className="btn btn-quiet btn-sm" aria-label={`Remove barcode ${formatBarcode(c)}`} onClick={() => remove(c)}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setScanning(true)}>
          <Icon name="barcode" size={16} /> {codes.length ? 'Add another' : 'Scan or type one'}
        </button>
      </dd>
      {scanning && <ScanDialog mode="capture" onClose={() => setScanning(false)} onCapture={add} />}
    </div>
  );
}
