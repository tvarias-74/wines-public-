import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyData, type CellarData } from '../domain/types';
import { validateData } from '../domain/portability';
import { buildRows, computeStats, type CellarStats, type WineRow } from '../domain/inventory';
import { referencedImageIds, type Result } from '../domain/actions';
import { toIsoDate } from '../domain/text';
import { collectUnusedImages } from './images';
import { StaleError, readStored, readStoredRev, requestPersistence, writeStored } from './storage';

/**
 * loading      reading what is saved
 * ready        the cellar is open and being saved
 * corrupt      something is saved but doesn't make sense: it is kept, offered for download, never overwritten
 * unavailable  storage could not be read at all, so we can't know what is saved: nothing is saved over it
 */
type Status = 'loading' | 'ready' | 'corrupt' | 'unavailable';

interface CellarContextValue {
  data: CellarData;
  status: Status;
  /** Set when saving failed, or when only the fallback store is working. */
  saveError: string | null;
  /** Another tab or window saved a newer cellar; this page's unsaved changes were not written. */
  conflict: boolean;
  /** The user chose to carry on without saved data: edits stay in memory and are not stored. */
  readOnly: boolean;
  /** Raw stored value that failed validation, so the user can still download it. */
  corruptRaw: unknown;
  unavailableReason: string | null;
  /** Today's date as `YYYY-MM-DD`, refreshed when the page wakes or midnight passes. */
  day: string;
  /** Applies a pure action to the latest data and saves it if it succeeded. */
  apply: <T extends { data: CellarData }>(fn: (d: CellarData) => Result<T>) => Result<T>;
  /** Replaces the whole cellar (restore, import, reset). */
  replaceAll: (next: CellarData) => void;
  startFresh: () => void;
  /** Read storage again (after "unavailable"). */
  retry: () => void;
  continueWithoutSaving: () => void;
  /** Throw away this page's unsaved changes and load what is saved. */
  reloadFromStorage: () => void;
  /** Writes any pending change now (before a reload, say). */
  flushNow: () => Promise<void>;
}

const CellarContext = createContext<CellarContextValue | null>(null);

const SAVE_DELAY_MS = 250;
const GC_DELAY_MS = 30_000;
const CHANNEL = 'cellar-book';

export function CellarProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CellarData>(emptyData);
  const [status, setStatus] = useState<Status>('loading');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [corruptRaw, setCorruptRaw] = useState<unknown>(undefined);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [day, setDay] = useState(() => toIsoDate(new Date()));

  const dataRef = useRef(data);
  const statusRef = useRef<Status>('loading');
  const revRef = useRef(0);
  const pending = useRef(false);
  const conflictRef = useRef(false);
  const readOnlyRef = useRef(false);
  const flushing = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(Math.random().toString(36).slice(2));

  const setStatusBoth = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const scheduleGc = useCallback(() => {
    if (gcTimer.current) clearTimeout(gcTimer.current);
    gcTimer.current = setTimeout(() => {
      if (statusRef.current !== 'ready') return;
      collectUnusedImages(referencedImageIds(dataRef.current)).catch(() => undefined);
    }, GC_DELAY_MS);
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (flushing.current) return flushing.current; // the running save re-checks `pending` when it finishes
    const run = async () => {
      while (pending.current && statusRef.current === 'ready' && !readOnlyRef.current && !conflictRef.current) {
        pending.current = false;
        const snapshot = dataRef.current;
        try {
          const r = await writeStored(snapshot, revRef.current);
          revRef.current = r.rev;
          setSaveError(r.usedFallback ? 'The browser’s main storage is not working here, so your changes are being kept in a smaller fallback store' : null);
          channel.current?.postMessage({ from: tabId.current, rev: r.rev });
          scheduleGc();
        } catch (e) {
          pending.current = true;
          if (e instanceof StaleError) {
            conflictRef.current = true;
            setConflict(true);
          } else setSaveError(e instanceof Error ? e.message : 'Could not save');
          return;
        }
      }
    };
    flushing.current = run().finally(() => {
      flushing.current = null;
    });
    return flushing.current;
  }, [scheduleGc]);

  const schedule = useCallback(() => {
    if (readOnlyRef.current) return;
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const load = useCallback(async () => {
    const r = await readStored();
    if (r.kind === 'unreadable') {
      setUnavailableReason(r.error);
      setStatusBoth('unavailable');
      return;
    }
    if (r.kind === 'empty') {
      dataRef.current = emptyData();
      revRef.current = 0;
      setData(dataRef.current);
      setStatusBoth('ready');
      return;
    }
    revRef.current = r.rev;
    try {
      dataRef.current = validateData(r.raw);
      setData(dataRef.current);
      setCorruptRaw(undefined);
      setStatusBoth('ready');
      scheduleGc();
    } catch {
      // Never overwrite something we could not understand: saving stays off until the user chooses.
      setCorruptRaw(r.raw);
      setStatusBoth('corrupt');
    }
  }, [scheduleGc, setStatusBoth]);

  useEffect(() => {
    void load().then(() => void requestPersistence());
  }, [load]);

  /** If another tab saved while this one slept, pick up its work (but never over unsaved edits here). */
  const refreshIfStale = useCallback(async () => {
    if (statusRef.current !== 'ready' || pending.current || flushing.current || conflictRef.current || readOnlyRef.current) return;
    const rev = await readStoredRev();
    if (rev !== undefined && rev !== revRef.current && !pending.current && !flushing.current) await load();
  }, [load]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL);
      channel.current = ch;
      ch.onmessage = (e: MessageEvent<{ from?: string }>) => {
        if (e.data?.from !== tabId.current) void refreshIfStale();
      };
    }
    const tick = () => setDay((prev) => {
      const now = toIsoDate(new Date());
      return now === prev ? prev : now;
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
      else {
        tick();
        void refreshIfStale();
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      tick();
      if (e.persisted) void refreshIfStale();
    };
    const onPageHide = () => void flush();
    const interval = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      channel.current?.close();
      channel.current = null;
    };
  }, [flush, refreshIfStale]);

  const replaceAll = useCallback(
    (next: CellarData) => {
      dataRef.current = next;
      setData(next);
      if (statusRef.current === 'corrupt') {
        setCorruptRaw(undefined);
        setStatusBoth('ready');
      }
      schedule();
    },
    [schedule, setStatusBoth],
  );

  const apply = useCallback(
    <T extends { data: CellarData }>(fn: (d: CellarData) => Result<T>): Result<T> => {
      const result = fn(dataRef.current);
      if (result.ok) {
        dataRef.current = result.data;
        setData(result.data);
        schedule();
      }
      return result;
    },
    [schedule],
  );

  const startFresh = useCallback(() => replaceAll(emptyData()), [replaceAll]);

  const retry = useCallback(() => {
    setStatusBoth('loading');
    void load();
  }, [load, setStatusBoth]);

  const continueWithoutSaving = useCallback(() => {
    readOnlyRef.current = true;
    setReadOnly(true);
    dataRef.current = emptyData();
    setData(dataRef.current);
    setStatusBoth('ready');
  }, [setStatusBoth]);

  const reloadFromStorage = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = false;
    conflictRef.current = false;
    setConflict(false);
    setSaveError(null);
    setStatusBoth('loading');
    void load();
  }, [load, setStatusBoth]);

  const value = useMemo<CellarContextValue>(
    () => ({ data, status, saveError, conflict, readOnly, corruptRaw, unavailableReason, day, apply, replaceAll, startFresh, retry, continueWithoutSaving, reloadFromStorage, flushNow: flush }),
    [data, status, saveError, conflict, readOnly, corruptRaw, unavailableReason, day, apply, replaceAll, startFresh, retry, continueWithoutSaving, reloadFromStorage, flush],
  );
  return <CellarContext.Provider value={value}>{children}</CellarContext.Provider>;
}

export function useCellar(): CellarContextValue {
  const ctx = useContext(CellarContext);
  if (!ctx) throw new Error('useCellar must be used inside <CellarProvider>');
  return ctx;
}

/** Derived rows and stats, refreshed when the data changes or the day turns over. */
export function useRows(): { data: CellarData; rows: WineRow[]; stats: CellarStats; now: Date } {
  const { data, day } = useCellar();
  return useMemo(() => {
    const now = new Date();
    const rows = buildRows(data, now);
    return { data, rows, stats: computeStats(rows), now };
  }, [data, day]);
}
