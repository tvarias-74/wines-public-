import { useSyncExternalStore } from 'react';

/**
 * A new version of the app is downloaded in the background and then waits. The shell offers an
 * "Update" button; nothing reloads by itself.
 */

let reload: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export function offerUpdate(fn: () => Promise<void>): void {
  reload = fn;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The function that installs the waiting update and reloads, or null when there isn't one. */
export function usePendingUpdate(): (() => Promise<void>) | null {
  return useSyncExternalStore(subscribe, () => reload);
}
