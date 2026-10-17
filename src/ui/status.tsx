import { STATUS_LABEL, STATUS_SHORT, type DrinkWindow, type WindowStatus } from '../domain/window';

/** A status is always shown as colour + text, never colour alone. */
export function StatusBadge({ status, short }: { status: WindowStatus; short?: boolean }) {
  return (
    <span className={`badge st-${status}`}>
      <i className="dot" aria-hidden="true" />
      {short ? STATUS_SHORT[status] : STATUS_LABEL[status]}
    </span>
  );
}

const DAY_MS = 86_400_000;

/** The current moment as a fractional year, e.g. 2026.79 for mid-October 2026. */
export function yearPosition(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 1).getTime();
  const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
  return now.getFullYear() + (now.getTime() - start) / (end - start || DAY_MS);
}

export interface Domain {
  start: number;
  end: number;
}

/** A sensible axis for one wine's window, with room on both sides and for open-ended windows. */
export function domainFor(w: DrinkWindow, nowPos: number): Domain {
  const from = w.drinkFrom ?? Math.min(nowPos - 1, (w.drinkTo ?? nowPos) - 6);
  const to = w.drinkTo !== undefined ? w.drinkTo + 1 : Math.max(nowPos + 6, from + 6);
  return { start: Math.floor(Math.min(from, nowPos) - 1), end: Math.ceil(Math.max(to, nowPos) + 1) };
}

/**
 * One drinking window drawn on a year axis: the window as a bar, the peak as a
 * darker inset, and a "now" marker. Windows are inclusive, so a window ending
 * in 2030 runs to the end of 2030.
 */
export function WindowTrack({ window: w, status, domain, nowPos, compact }: { window: DrinkWindow; status: WindowStatus; domain: Domain; nowPos: number; compact?: boolean }) {
  const span = domain.end - domain.start || 1;
  const pct = (y: number) => `${Math.max(0, Math.min(100, ((y - domain.start) / span) * 100))}%`;
  const hasFrom = w.drinkFrom !== undefined;
  const hasTo = w.drinkTo !== undefined;
  const barStart = hasFrom ? (w.drinkFrom as number) : domain.start;
  const barEnd = hasTo ? (w.drinkTo as number) + 1 : domain.end;
  const peakStart = w.peakFrom ?? (w.peakTo !== undefined ? barStart : undefined);
  const peakEnd = w.peakTo !== undefined ? w.peakTo + 1 : w.peakFrom !== undefined ? barEnd : undefined;
  const hasWindow = hasFrom || hasTo;

  return (
    <div className={`track${compact ? ' track-compact' : ''}`}>
      <div className="track-rail" />
      {hasWindow && (
        <div
          className={`track-bar st-${status}${hasFrom && barStart >= domain.start ? '' : ' open-start'}${hasTo && barEnd <= domain.end ? '' : ' open-end'}`}
          style={{ left: pct(barStart), width: `calc(${pct(barEnd)} - ${pct(barStart)})` }}
        >
          {peakStart !== undefined && peakEnd !== undefined && (
            <span
              className="track-peak"
              style={{ left: `${((peakStart - barStart) / (barEnd - barStart || 1)) * 100}%`, width: `${((peakEnd - peakStart) / (barEnd - barStart || 1)) * 100}%` }}
            />
          )}
        </div>
      )}
      <div className="track-now" style={{ left: pct(nowPos) }} title="Today" />
    </div>
  );
}
