import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addCustomImpression, hasSampleData, hasSampleLeftovers, markBackedUp, removeCustomImpression, removeSampleData, updateSettings } from '../../domain/actions';
import { exportInventoryCsv, importInventoryCsv, type CsvImportReport } from '../../domain/portability';
import { CURRENCIES, emptyData, type CellarData } from '../../domain/types';
import { decodeText, formatDate, pluralize, toIsoDate } from '../../domain/text';
import { createBackupFile, photoStats } from '../../storage/backupFiles';
import { deleteAllImages } from '../../storage/images';
import { applyTheme, isPersisted, readTheme, type ThemePreference } from '../../storage/storage';
import { useCellar } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, Field, PageHead } from '../components';
import { downloadFile, formatBytes } from '../format';
import { addSampleWines } from '../loadSample';
import { Modal, useConfirm, useToast } from '../overlays';
import { useRestore } from '../restore';

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {id && <div id={id} className="anchor" />}
      {children}
    </Card>
  );
}

/** A stored timestamp as the user's own calendar day (not the UTC day). */
const localDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : toIsoDate(d);
};

interface CsvFile {
  fileName: string;
  text: string;
  encoding: ReturnType<typeof decodeText>['encoding'];
}

export function Settings() {
  const { data, apply, replaceAll, flushNow, readOnly } = useCellar();
  const restore = useRestore();
  const confirm = useConfirm();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [semicolon, setSemicolon] = useState(false);
  const [csv, setCsv] = useState<CsvFile | null>(null);
  const [photos, setPhotos] = useState<{ count: number; bytes: number } | null>(null);
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newWord, setNewWord] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void isPersisted().then(setPersisted);
    void photoStats().then(setPhotos, () => setPhotos(null));
  }, []);

  const wineCount = data.vintages.length;
  const sample = hasSampleData(data);
  const layoutCount = data.locations.length;
  const photoNote = photos && photos.count > 0 ? ` including ${pluralize(photos.count, 'label photo')} (${formatBytes(photos.bytes)})` : '';

  const exportBackup = async () => {
    setBusy('backup');
    try {
      const now = new Date();
      const file = await createBackupFile(data, withPhotos, now);
      downloadFile(file.filename, file.blob);
      apply((d) => ({ ok: true as const, data: markBackedUp(d, now.toISOString()) }));
      toast(file.photos ? `Backup downloaded with ${pluralize(file.photos, 'photo')}. Keep it somewhere safe, like your cloud drive.` : 'Backup downloaded. Keep it somewhere safe, like your cloud drive.');
    } catch (e) {
      toast(e instanceof Error ? `The backup could not be made: ${e.message}` : 'The backup could not be made', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async (file: File) => {
    setBusy('restore');
    try {
      if (await restore(file)) void photoStats().then(setPhotos, () => undefined);
    } finally {
      setBusy(null);
    }
  };

  const readCsv = async (file: File) => {
    const { text, encoding } = decodeText(await file.arrayBuffer());
    setCsv({ fileName: file.name, text, encoding });
  };

  /** The import is applied to the cellar as it is when the button is pressed, not as it was when the file was read. */
  const confirmCsv = () => {
    if (!csv) return;
    const r = apply<{ data: CellarData; report: CsvImportReport }>((d) => {
      const report = importInventoryCsv(d, csv.text, new Date());
      return report.imported === 0 ? { ok: false as const, error: 'Nothing could be imported from this file.' } : { ok: true as const, data: report.data, report };
    });
    if (!r.ok) {
      toast(r.error, { tone: 'error' });
      return;
    }
    toast(`Imported ${pluralize(r.report.imported, 'row')} (${pluralize(r.report.bottles, 'bottle')})`);
    setCsv(null);
  };

  const eraseAll = async () => {
    const ok = await confirm({
      title: 'Delete everything?',
      message: (
        <>
          <p>
            All {pluralize(wineCount, 'wine')}, purchases, tastings, storage layout and label photos on this device will be permanently deleted. There is no undo.
          </p>
          <p>{data.meta.lastBackupAt ? `Your last backup was on ${formatDate(localDay(data.meta.lastBackupAt))}.` : 'You have not made a backup yet.'}</p>
        </>
      ),
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (ok) {
      replaceAll(emptyData());
      // The pictures go too, but only once the empty cellar is safely saved: until then they are all that is left of the real one.
      if (await flushNow()) {
        await deleteAllImages().catch(() => undefined);
        void photoStats().then(setPhotos, () => undefined);
        toast('Your cellar was cleared');
      } else {
        toast('Cleared on this page, but that could not be saved — see the message at the top.', { tone: 'error' });
      }
    }
  };

  const addWord = () => {
    if (!newWord.trim()) return;
    apply((d) => ({ ok: true as const, data: addCustomImpression(d, newWord) }));
    setNewWord('');
  };

  return (
    <>
      <PageHead title="Settings" subtitle="Your preferences, and your data." />

      <Section title="Preferences">
        <div className="form-grid">
          <Field label="Currency" hint="Used for every price. Changing it doesn’t convert amounts.">
            {(id, d) => (
              <select id={id} value={data.settings.currency} aria-describedby={d} onChange={(e) => apply((x) => ({ ok: true as const, data: updateSettings(x, { currency: e.target.value }) }))}>
                {[...new Set([data.settings.currency, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="“Drink soon” means" hint="A window closing within this time is flagged.">
            {(id, d) => (
              <select id={id} value={data.settings.drinkSoonYears} aria-describedby={d} onChange={(e) => apply((x) => ({ ok: true as const, data: updateSettings(x, { drinkSoonYears: Number(e.target.value) }) }))}>
                <option value={0}>closing this year</option>
                <option value={1}>closing within 1 year</option>
                <option value={2}>closing within 2 years</option>
                <option value={3}>closing within 3 years</option>
                <option value={5}>closing within 5 years</option>
              </select>
            )}
          </Field>
          <Field label="Appearance">
            {(id) => (
              <select
                id={id}
                value={theme}
                onChange={(e) => {
                  const t = e.target.value as ThemePreference;
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                <option value="auto">Match my device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Cellar layout" subtitle={layoutCount ? `${pluralize(layoutCount, 'place')} set up. New divisions hold ${data.settings.divisionCapacity} bottles unless you say otherwise.` : 'Set up your numbered divisions and any boxes on the floor, so every bottle has a place.'}>
        <div className="settings-actions">
          <Link className="btn" to="/layout">
            <Icon name="grid" size={18} /> {layoutCount ? 'Edit cellar layout' : 'Set up cellar layout'}
          </Link>
        </div>
      </Section>

      <Section title="Tasting words" subtitle="The ready-made impressions (fruit, spice, structure…) are always there. Add words of your own and they will be offered alongside them when you record a tasting.">
        <form
          className="add-word"
          onSubmit={(e) => {
            e.preventDefault();
            addWord();
          }}
        >
          <label className="sr-only" htmlFor="new-word">
            A tasting word of your own
          </label>
          <input id="new-word" value={newWord} maxLength={60} onChange={(e) => setNewWord(e.target.value)} placeholder="e.g. wet slate, rosewater" autoCapitalize="none" />
          <button className="btn" type="submit" disabled={!newWord.trim()}>
            <Icon name="plus" size={16} /> Add word
          </button>
        </form>
        {data.settings.customImpressions.length > 0 ? (
          <ul className="tags-list" aria-label="Your tasting words">
            {data.settings.customImpressions.map((w) => (
              <li key={w}>
                <span className="word">{w}</span>
                <button className="btn btn-quiet btn-sm" aria-label={`Remove ${w}`} onClick={() => apply((d) => ({ ok: true as const, data: removeCustomImpression(d, w) }))}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-foot muted">No words of your own yet.</p>
        )}
      </Section>

      <Section
        id="backup"
        title="Back up and restore"
        subtitle="Your cellar is stored only on this device, in this browser. A backup file is the safe copy — and how you move your cellar to another device."
      >
        {photos && photos.count > 0 && (
          <label className="check">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            Include label photos ({pluralize(photos.count, 'photo')}, about {formatBytes(photos.bytes)})
          </label>
        )}
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={() => void exportBackup()} disabled={wineCount === 0 || busy !== null}>
            <Icon name="download" size={18} /> {busy === 'backup' ? 'Preparing…' : 'Download backup'}
          </button>
          <button className="btn" onClick={() => backupInput.current?.click()} disabled={busy !== null}>
            <Icon name="upload" size={18} /> {busy === 'restore' ? 'Reading…' : 'Restore from backup…'}
          </button>
          <input
            ref={backupInput}
            type="file"
            accept="application/json,application/zip,.json,.zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restoreBackup(f);
            }}
          />
        </div>
        <p className="card-foot muted">
          {withPhotos && photos && photos.count > 0
            ? `The backup is a .zip file with your wines${photoNote}.`
            : 'The backup is a .json file with your wines. Label photos are only saved when you include them, and then it becomes a .zip.'}{' '}
          {data.meta.lastBackupAt ? `Last backup: ${formatDate(localDay(data.meta.lastBackupAt))}.` : 'No backup yet.'}{' '}
          {persisted === true && 'This browser has promised to keep your data.'}
          {persisted === false && 'The browser may clear this data if the device runs low on space — another reason to keep a backup.'}
        </p>
      </Section>

      <Section id="import" title="Spreadsheet" subtitle="Bring in an existing list, or take your cellar into Excel or Google Sheets.">
        <div className="settings-actions">
          <button className="btn" onClick={() => csvInput.current?.click()}>
            <Icon name="upload" size={18} /> Import a CSV…
          </button>
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readCsv(f);
            }}
          />
          <button
            className="btn"
            disabled={wineCount === 0}
            onClick={() => downloadFile(`cellar-book-${toIsoDate(new Date())}.csv`, exportInventoryCsv(data, semicolon ? ';' : ','), 'text/csv')}
          >
            <Icon name="download" size={18} /> Export wines in stock (CSV)
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={semicolon} onChange={(e) => setSemicolon(e.target.checked)} />
          Use semicolons (for Excel set to a European language)
        </label>
        <details className="help">
          <summary>What should my CSV look like?</summary>
          <p>
            The first row names the columns. Only <strong>Producer</strong> (or “Winery”) and <strong>Bottling</strong> (or “Wine”, “Cuvée”) are required; the rest are used when present:
          </p>
          <p className="mono">
            Producer, Group, Bottling, Vintage, Colour, Sparkling, Style, Type, Size, Country, Region, Appellation, Varieties, Bottles, Price, Purchase date, Merchant, Drink from, Drink to, Peak from, Peak to, Locations, Notes
          </p>
          <ul>
            <li>Each row adds that many bottles to the wine. Rows for the same winery, bottling and vintage are combined.</li>
            <li>
              <strong>Colour</strong> is red, white, rosé or orange; <strong>Sparkling</strong> is yes or no. A single “Type” column (“Red”, “Champagne”, “Sparkling rosé”…) also works, but a wine whose colour can’t be read is added without one rather than guessed.
            </li>
            <li>
              <strong>Group</strong> is the family or company behind the winery (Antinori, Karamolegos…). <strong>Locations</strong> can be “Division 12: 6; Wooden box 3: 4” — the number after the colon is how many bottles.
            </li>
            <li>Write non-vintage wines as “NV”. Varieties can be “Merlot 60%; Cabernet Franc 40%”.</li>
            <li>Dates can be YYYY-MM-DD or DD/MM/YYYY (day first), or just a year. Commas or semicolons both work.</li>
            <li>A dot or comma followed by exactly three digits is read as a thousands separator (1.500 is fifteen hundred), except after a leading zero (0.750 is three quarters).</li>
            <li>The CSV holds the wines, not their photos, tastings or reviews. For a full backup, use the backup file.</li>
          </ul>
        </details>
      </Section>

      <Section title="Sample wines" subtitle="A made-up cellar for trying things out, with label pictures, storage places and tastings. Your own wines are never touched.">
        <div className="settings-actions">
          {sample ? (
            <button
              className="btn"
              onClick={async () => {
                if (await confirm({ title: 'Remove sample wines?', message: 'The demo wines, their purchases, tastings and pictures are deleted. Anything you added yourself is kept.', confirmLabel: 'Remove samples', danger: true })) {
                  apply((d) => ({ ok: true as const, data: removeSampleData(d) }));
                  toast('Sample wines removed');
                }
              }}
            >
              Remove sample wines
            </button>
          ) : hasSampleLeftovers(data) ? (
            <p className="card-sub">Some sample wines became yours when you added bottles or notes to them, so the sample can’t be added again without doubling them up.</p>
          ) : (
            <button
              className="btn"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('sample');
                try {
                  await addSampleWines(apply, data);
                  toast('Sample wines added');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'sample' ? 'Adding…' : 'Add sample wines'}
            </button>
          )}
        </div>
      </Section>

      <Section title="Delete everything">
        <p className="card-sub">Permanently removes all wines, purchases, history and label photos from this device.</p>
        <div className="settings-actions">
          <button className="btn btn-danger" onClick={eraseAll} disabled={(wineCount === 0 && layoutCount === 0) || readOnly}>
            <Icon name="trash" size={18} /> Delete all my data
          </button>
        </div>
      </Section>

      <Section title="About">
        <p className="card-sub">
          Cellar Book keeps your wines on this device and works offline. Drinking windows are whole calendar years, both ends included. Estimates offered while adding a wine are rules of thumb by aging potential, not tasting advice, and are marked “est.” until you change them. Reviews from Vivino, Robert Parker or Jancis Robinson are ones you enter yourself: Cellar Book gives you a search link for each, but doesn’t fetch scores for you.
        </p>
      </Section>

      {csv && <CsvDialog csv={csv} onCancel={() => setCsv(null)} onConfirm={confirmCsv} />}
    </>
  );
}

function CsvDialog({ csv, onCancel, onConfirm }: { csv: CsvFile; onCancel: () => void; onConfirm: () => void }) {
  const { data } = useCellar();
  const report = useMemo(() => importInventoryCsv(data, csv.text, new Date()), [data, csv.text]);
  return (
    <Modal
      wide
      title="Import from CSV"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={report.imported === 0} onClick={onConfirm}>
            Import {pluralize(report.imported, 'row')}
          </button>
        </>
      }
    >
      <CsvPreview csv={csv} report={report} />
    </Modal>
  );
}

function CsvPreview({ csv, report }: { csv: CsvFile; report: CsvImportReport }) {
  return (
    <div className="csv-preview">
      <p>
        <strong>{csv.fileName}</strong>
      </p>
      {csv.encoding === 'windows-1252' && (
        <div className="notice notice-warn">
          <p>
            This file isn’t saved as UTF-8, so it was read as Windows-1252 (the usual Excel format). Check that accented and Greek-transliterated names look right below; if not, save it from your spreadsheet as “CSV UTF-8”.
          </p>
        </div>
      )}
      <p>
        {report.imported > 0 ? (
          <>
            Ready to import <strong>{pluralize(report.imported, 'row')}</strong> — {pluralize(report.bottles, 'bottle')}
            {report.merged > 0 ? `, ${report.merged} added to wines that already exist` : ''}. This adds to your cellar; nothing is removed.
          </>
        ) : (
          <strong>Nothing can be imported from this file.</strong>
        )}
      </p>
      {report.errors.length > 0 && (
        <div className="notice notice-warn">
          <p>
            <strong>{pluralize(report.errors.length, 'row')} will be skipped:</strong>
          </p>
          <ul>
            {report.errors.slice(0, 8).map((e) => (
              <li key={`${e.row}-${e.message}`}>
                {e.row > 0 ? `Row ${e.row}: ` : ''}
                {e.message}
              </li>
            ))}
            {report.errors.length > 8 && <li>…and {report.errors.length - 8} more.</li>}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="notice">
          <ul>
            {report.warnings.slice(0, 8).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {report.warnings.length > 8 && <li>…and {report.warnings.length - 8} more.</li>}
          </ul>
        </div>
      )}
      {report.recognised.length > 0 && (
        <details className="help">
          <summary>Columns understood ({report.recognised.length})</summary>
          <ul>
            {report.recognised.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {report.ignored.length > 0 && <p className="muted">Ignored: {report.ignored.join(', ')}</p>}
        </details>
      )}
    </div>
  );
}
