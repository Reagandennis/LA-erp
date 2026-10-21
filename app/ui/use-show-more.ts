'use client';

import { useState } from 'react';

export const SHOW_MORE_STEP = 60;

/**
 * Renders a long list a page at a time. Filtering and searching still run over
 * the whole list; only the DOM is limited, which is what keeps a screen with
 * thousands of rows (a FileMaker-sized history) quick to paint and hydrate.
 * The window belongs to the list it was opened on, so a different list (a new
 * filter or search) starts at the first page again without an effect.
 */
export function useShowMore<T>(items: T[], step = SHOW_MORE_STEP) {
  const [window, setWindow] = useState<{ of: T[]; limit: number } | null>(null);
  const limit = window && window.of === items ? window.limit : step;

  const visible = items.length > limit ? items.slice(0, limit) : items;
  return {
    visible,
    hiddenCount: Math.max(0, items.length - visible.length),
    showMore: () => setWindow({ of: items, limit: limit + step }),
    showAll: () => setWindow({ of: items, limit: items.length }),
  };
}
