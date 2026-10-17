import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyData, type CellarData } from '../domain/types';
import { validateData } from '../domain/portability';
import { buildRows, computeStats, type CellarStats, type WineRow } from '../domain/inventory';
import type { Result } from '../domain/actions';
import { readStored, requestPersistence, writeStored } from './storage';

type Status = 'loading' | 'ready' | 'corrupt';

interface CellarContextValue {
  data: CellarData;
  status: Status;
  /** Set when the last attempt to save failed (e.g. private browsing, disk full). */
  saveError: string | null;
  /** Raw stored value that failed validation, so the user can still download it. */
  corruptRaw: unknown;
  /** Applies a pure action to the latest data and saves it if it succeeded. */
  apply: <T extends { data: CellarData }>(fn: (d: CellarData) => Result<T>) => Result<T>;
  /** Replaces the whole cellar (restore, import, reset). */
  replaceAll: (next: CellarData) => void;
  startFresh: () => void;
}

const CellarContext = createContext<CellarContextValue | null>(null);

const SAVE_DELAY_MS = 250;
const CHANNEL = 'cellar-book';

export function CellarProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CellarData>(emptyData);
  const [status, setStatus] = useState<Status>('loading');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [corruptRaw, setCorruptRaw] = useState<unknown>(undefined);

  const dataRef = useRef(data);
  const statusRef = useRef<Status>('loading');
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(Math.random().toString(36).slice(2));

  const setStatusBoth = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current || statusRef.current !== 'ready') return;
    pending.current = false;
    try {
      await writeStored(dataRef.current);
      setSaveError(null);
      channel.current?.postMessage({ from: tabId.current });
    } catch (e) {
      pending.current = true;
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    }
  }, []);

  const schedule = useCallback(() => {
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const load = useCallback(async () => {
    const raw = await readStored();
    if (raw === undefined) {
      dataRef.current = emptyData();
      setData(dataRef.current);
      setStatusBoth('ready');
      return;
    }
    try {
      dataRef.current = validateData(raw);
      setData(dataRef.current);
      setCorruptRaw(undefined);
      setStatusBoth('ready');
    } catch {
      // Never overwrite something we could not understand: saving stays off until the user chooses.
      setCorruptRaw(raw);
      setStatusBoth('corrupt');
    }
  }, [setStatusBoth]);

  useEffect(() => {
    void load().then(() => void requestPersistence());
  }, [load]);

  // Keep several open tabs in step, and never lose a pending edit when the page goes away.
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL);
      channel.current = ch;
      ch.onmessage = (e: MessageEvent<{ from?: string }>) => {
        if (e.data?.from !== tabId.current && !pending.current && statusRef.current === 'ready') void load();
      };
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      channel.current?.close();
      channel.current = null;
    };
  }, [flush, load]);

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

  const value = useMemo<CellarContextValue>(
    () => ({ data, status, saveError, corruptRaw, apply, replaceAll, startFresh }),
    [data, status, saveError, corruptRaw, apply, replaceAll, startFresh],
  );
  return <CellarContext.Provider value={value}>{children}</CellarContext.Provider>;
}

export function useCellar(): CellarContextValue {
  const ctx = useContext(CellarContext);
  if (!ctx) throw new Error('useCellar must be used inside <CellarProvider>');
  return ctx;
}

/** Derived rows and stats for the current moment. */
export function useRows(): { data: CellarData; rows: WineRow[]; stats: CellarStats; now: Date } {
  const { data } = useCellar();
  return useMemo(() => {
    const now = new Date();
    const rows = buildRows(data, now);
    return { data, rows, stats: computeStats(rows), now };
  }, [data]);
}
