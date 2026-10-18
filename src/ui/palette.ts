import type { WindowStatus } from '../domain/window';

/** CSS custom properties, defined (and validated) for light and dark in styles.css. */
export const STATUS_VAR: Record<WindowStatus, string> = {
  hold: 'var(--st-hold)',
  ready: 'var(--st-ready)',
  peak: 'var(--st-peak)',
  soon: 'var(--st-soon)',
  past: 'var(--st-past)',
  unknown: 'var(--st-unknown)',
};
