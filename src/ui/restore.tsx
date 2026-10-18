import { useCallback } from 'react';
import { pluralize } from '../domain/text';
import { createBackupFile, readBackupFile, storeBackupImages } from '../storage/backupFiles';
import { useCellar } from '../storage/store';
import { downloadFile } from './format';
import { useConfirm, useToast } from './overlays';

/**
 * Replaces the cellar with a backup file: checks it completely, asks, puts the pictures in first (so a
 * failure there changes nothing), then replaces the cellar and only says "restored" once it is saved.
 * Returns true when the cellar was replaced.
 */
export function useRestore(): (file: File) => Promise<boolean> {
  const { data, replaceAll, flushNow } = useCellar();
  const confirm = useConfirm();
  const toast = useToast();

  return useCallback(
    async (file: File) => {
      try {
        const parsed = await readBackupFile(file);
        if (!parsed.ok) {
          toast(parsed.error, { tone: 'error' });
          return false;
        }
        const incoming = parsed.data;
        const wineCount = data.vintages.length;
        const ok = await confirm({
          title: 'Replace your cellar with this backup?',
          message: (
            <>
              <p>
                <strong>{file.name}</strong> contains {pluralize(incoming.vintages.length, 'wine')}, {pluralize(incoming.purchases.length, 'purchase')}, {pluralize(incoming.consumptions.length, 'tasting/removal')}, {pluralize(incoming.locations.length, 'storage place')}
                {parsed.images.length ? ` and ${pluralize(parsed.images.length, 'label photo')}` : ''}.
              </p>
              {parsed.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <p>
                Your current cellar ({pluralize(wineCount, 'wine')}) will be <strong>replaced</strong>.
              </p>
              {wineCount > 0 && (
                <p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const copy = await createBackupFile(data, false);
                      downloadFile(copy.filename.replace('backup', 'before-restore'), copy.blob);
                    }}
                  >
                    Download my current cellar first
                  </button>
                </p>
              )}
            </>
          ),
          confirmLabel: 'Replace my cellar',
          danger: wineCount > 0,
        });
        if (!ok) return false;
        await storeBackupImages(parsed.images);
        replaceAll(incoming);
        const saved = await flushNow();
        if (saved) toast('Backup restored');
        else toast('The backup is open, but it could not be saved on this device. Do not close this page: see the message at the top.', { tone: 'error' });
        return true;
      } catch (e) {
        toast(e instanceof Error ? `The backup could not be restored: ${e.message}` : 'The backup could not be restored', { tone: 'error' });
        return false;
      }
    },
    [data, replaceAll, flushNow, confirm, toast],
  );
}
