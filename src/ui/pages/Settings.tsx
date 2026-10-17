import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hasSampleData, markBackedUp, removeSampleData, updateSettings } from '../../domain/actions';
import { exportInventoryCsv, importInventoryCsv, parseBackup, serializeBackup, type CsvImportReport } from '../../domain/portability';
import { buildSampleData } from '../../domain/sample';
import { CURRENCIES, emptyData } from '../../domain/types';
import { formatDate, pluralize, toIsoDate } from '../../domain/text';
import { applyTheme, isPersisted, readTheme, type ThemePreference } from '../../storage/storage';
import { useCellar } from '../../storage/store';
import { Icon } from '../Icon';
import { Card, Field, PageHead } from '../components';
import { downloadFile } from '../format';
import { Modal, useConfirm, useToast } from '../overlays';

function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {id && <div id={id} className="anchor" />}
      {children}
    </Card>
  );
}

export function Settings() {
  const { data, apply, replaceAll, saveError } = useCellar();
  const confirm = useConfirm();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [semicolon, setSemicolon] = useState(false);
  const [csvReport, setCsvReport] = useState<{ fileName: string; report: CsvImportReport } | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, []);

  const wineCount = data.vintages.length;
  const sample = hasSampleData(data);

  const exportBackup = () => {
    const now = new Date();
    downloadFile(`cellar-book-backup-${toIsoDate(now)}.json`, serializeBackup(data, now), 'application/json');
    apply((d) => ({ ok: true as const, data: markBackedUp(d, now.toISOString()) }));
    toast('Backup downloaded. Keep it somewhere safe, like your cloud drive.');
  };

  const restoreBackup = async (file: File) => {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      toast(parsed.error, { tone: 'error' });
      return;
    }
    const incoming = parsed.data;
    const ok = await confirm({
      title: 'Replace your cellar with this backup?',
      message: (
        <>
          <p>
            <strong>{file.name}</strong> contains {pluralize(incoming.vintages.length, 'wine')}, {pluralize(incoming.purchases.length, 'purchase')} and {pluralize(incoming.consumptions.length, 'tasting/removal')}.
          </p>
          <p>
            Your current cellar ({pluralize(wineCount, 'wine')}) will be <strong>replaced</strong>. Back it up first if you might want it again.
          </p>
        </>
      ),
      confirmLabel: 'Replace my cellar',
      danger: wineCount > 0,
    });
    if (!ok) return;
    replaceAll(incoming);
    toast('Backup restored');
  };

  const readCsv = async (file: File) => {
    const text = await file.text();
    setCsvReport({ fileName: file.name, report: importInventoryCsv(data, text, new Date()) });
  };

  const eraseAll = async () => {
    const ok = await confirm({
      title: 'Delete everything?',
      message: (
        <>
          <p>
            All {pluralize(wineCount, 'wine')}, purchases and history on this device will be permanently deleted. There is no undo.
          </p>
          <p>{data.meta.lastBackupAt ? `Your last backup was on ${formatDate(data.meta.lastBackupAt.slice(0, 10))}.` : 'You have not made a backup yet.'}</p>
        </>
      ),
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (ok) {
      replaceAll(emptyData());
      toast('Your cellar was cleared');
    }
  };

  return (
    <>
      <PageHead title="Settings" subtitle="Your preferences, and your data." />

      {saveError && (
        <div className="banner banner-warn" role="alert">
          <Icon name="alert" />
          <p>
            <strong>Changes can’t be saved in this browser.</strong> {saveError}. This often happens in a private window. Download a backup so nothing is lost.
          </p>
        </div>
      )}

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

      <Section id="backup" title="Back up and restore" subtitle="Your cellar is stored only on this device, in this browser. A backup file is the safe copy — and how you move your cellar to another device.">
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={exportBackup} disabled={wineCount === 0}>
            <Icon name="download" size={18} /> Download backup
          </button>
          <button className="btn" onClick={() => jsonInput.current?.click()}>
            <Icon name="upload" size={18} /> Restore from backup…
          </button>
          <input
            ref={jsonInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restoreBackup(f);
            }}
          />
        </div>
        <p className="card-foot muted">
          {data.meta.lastBackupAt ? `Last backup: ${formatDate(data.meta.lastBackupAt.slice(0, 10))}.` : 'No backup yet.'}{' '}
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
            The first row names the columns. Only <strong>Producer</strong> and <strong>Bottling</strong> (or “Wine”, “Cuvée”) are required; the rest are used when present:
          </p>
          <p className="mono">Producer, Bottling, Vintage, Type, Size, Country, Region, Appellation, Varieties, Bottles, Price, Purchase date, Merchant, Drink from, Drink to, Peak from, Peak to, Location, Notes</p>
          <ul>
            <li>Each row adds that many bottles to the wine. Rows for the same producer, bottling and vintage are combined.</li>
            <li>Write non-vintage wines as “NV”. Varieties can be “Merlot 60%; Cabernet Franc 40%”.</li>
            <li>Dates can be YYYY-MM-DD or DD/MM/YYYY (day first), or just a year. Commas or semicolons both work.</li>
            <li>The CSV export is for spreadsheets. For a full backup of purchases and history, use the backup file.</li>
          </ul>
        </details>
      </Section>

      <Section title="Sample wines" subtitle="A made-up cellar for trying things out. Your own wines are never touched.">
        <div className="settings-actions">
          {sample ? (
            <button
              className="btn"
              onClick={async () => {
                if (await confirm({ title: 'Remove sample wines?', message: 'The demo wines and their purchases are deleted. Anything you added yourself is kept.', confirmLabel: 'Remove samples', danger: true })) {
                  apply((d) => ({ ok: true as const, data: removeSampleData(d) }));
                  toast('Sample wines removed');
                }
              }}
            >
              Remove sample wines
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                replaceAll(buildSampleData(data));
                toast('Sample wines added');
              }}
            >
              Add sample wines
            </button>
          )}
        </div>
      </Section>

      <Section title="Delete everything">
        <p className="card-sub">Permanently removes all wines, purchases and history from this device.</p>
        <div className="settings-actions">
          <button className="btn btn-danger" onClick={eraseAll} disabled={wineCount === 0}>
            <Icon name="trash" size={18} /> Delete all my data
          </button>
        </div>
      </Section>

      <Section title="About">
        <p className="card-sub">
          Cellar Book keeps your wines on this device and works offline. Drinking windows are whole calendar years, both ends included. Estimates offered while adding a wine are rules of thumb by aging potential, not tasting advice, and are marked “est.” until you change them.
        </p>
      </Section>

      {csvReport && (
        <Modal
          wide
          title="Import from CSV"
          onClose={() => setCsvReport(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCsvReport(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={csvReport.report.imported === 0}
                onClick={() => {
                  replaceAll(csvReport.report.data);
                  toast(`Imported ${pluralize(csvReport.report.imported, 'row')} (${pluralize(csvReport.report.bottles, 'bottle')})`);
                  setCsvReport(null);
                }}
              >
                Import {pluralize(csvReport.report.imported, 'row')}
              </button>
            </>
          }
        >
          <CsvPreview fileName={csvReport.fileName} report={csvReport.report} />
        </Modal>
      )}
    </>
  );
}

function CsvPreview({ fileName, report }: { fileName: string; report: CsvImportReport }) {
  return (
    <div className="csv-preview">
      <p>
        <strong>{fileName}</strong>
      </p>
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
            <strong>
              {pluralize(report.errors.length, 'row')} will be skipped:
            </strong>
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
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
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
