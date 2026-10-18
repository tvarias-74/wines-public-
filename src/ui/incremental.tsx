import { useState } from 'react';

/**
 * Renders a long list a page at a time. The limit resets whenever the list
 * itself changes (a new filter, new data), so you always start at the top.
 */
export function useIncremental<T>(items: T[], step = 150) {
  const [state, setState] = useState({ items, limit: step });
  let limit = state.limit;
  if (state.items !== items) {
    limit = step;
    setState({ items, limit });
  }
  return {
    visible: items.length > limit ? items.slice(0, limit) : items,
    remaining: Math.max(0, items.length - limit),
    more: () => setState((s) => ({ ...s, limit: s.limit + step })),
    all: () => setState((s) => ({ ...s, limit: items.length })),
  };
}

export function ShowMore({ remaining, onMore, onAll, noun = 'more' }: { remaining: number; onMore: () => void; onAll: () => void; noun?: string }) {
  if (remaining <= 0) return null;
  return (
    <div className="show-more">
      <button className="btn" onClick={onMore}>
        Show more {noun}
      </button>
      <button className="btn btn-quiet" onClick={onAll}>
        Show all {remaining.toLocaleString()} remaining
      </button>
    </div>
  );
}
