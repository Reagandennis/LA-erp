'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { insertionIndex } from '../itinerary-model';
import type { TripItineraryItemSummary } from '../../types';

/** Pointer travel before a press becomes a drag, matching kanban-board. */
const DRAG_THRESHOLD = 5;
/** How close to a pane edge before it starts scrolling itself. */
const EDGE_BAND = 56;

export interface DragTarget {
  dayId: number | null;
  /**
   * Insertion index into the destination list **with the dragged item already
   * removed** — the convention `applyReorder` expects.
   */
  index: number;
}

export interface ItineraryDragState {
  itemId: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  target: DragTarget | null;
}

interface Options {
  /** Items currently rendered in the right-hand pane, in display order. */
  items: TripItineraryItemSummary[];
  activeDayId: number | null;
  enabled: boolean;
  onCommit: (itemId: number, target: DragTarget) => void;
  /** A press that never crossed the threshold is a click, not a drag. */
  onClick?: (itemId: number) => void;
}

export function useItineraryDrag({ items, activeDayId, enabled, onCommit, onClick }: Options) {
  const [drag, setDrag] = useState<ItineraryDragState | null>(null);

  const eventEls = useRef(new Map<number, HTMLElement>());
  const dayCardEls = useRef(new Map<string, HTMLElement>());
  const paneEl = useRef<HTMLElement | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  // Pointer handlers run outside React's render, so they must not close over a
  // stale item list mid-drag.
  const stateRef = useRef({ items, activeDayId });
  useEffect(() => {
    stateRef.current = { items, activeDayId };
  }, [items, activeDayId]);

  useEffect(() => () => {
    teardownRef.current?.();
    if (autoScrollRef.current !== null) cancelAnimationFrame(autoScrollRef.current);
  }, []);

  // React 19 ref-cleanup callbacks, so nothing reads a ref during render.
  const registerEvent = (id: number) => (el: HTMLElement | null) => {
    if (!el) return;
    eventEls.current.set(id, el);
    return () => {
      eventEls.current.delete(id);
    };
  };

  /** `key` is a day id, or "unscheduled" for the tray row. */
  const registerDayCard = (key: number | null) => (el: HTMLElement | null) => {
    const mapKey = key === null ? 'unscheduled' : String(key);
    if (!el) return;
    dayCardEls.current.set(mapKey, el);
    return () => {
      dayCardEls.current.delete(mapKey);
    };
  };

  const registerPane = (el: HTMLElement | null) => {
    paneEl.current = el;
  };

  const within = (rect: DOMRect, x: number, y: number) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  const computeTarget = (px: number, py: number, draggedId: number): DragTarget | null => {
    // The rail wins over the pane: dropping on a day card moves the event
    // there and appends, which is how you empty a day quickly.
    for (const [key, el] of dayCardEls.current) {
      if (within(el.getBoundingClientRect(), px, py)) {
        const dayId = key === 'unscheduled' ? null : Number(key);
        return { dayId, index: Number.MAX_SAFE_INTEGER };
      }
    }

    const pane = paneEl.current;
    if (pane && within(pane.getBoundingClientRect(), px, py)) {
      const { items: current, activeDayId: dayId } = stateRef.current;
      const rects = current
        .filter((item) => item.id !== draggedId)
        .map((item) => eventEls.current.get(item.id))
        .filter((el): el is HTMLElement => Boolean(el))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        });
      return { dayId, index: insertionIndex(rects, py) };
    }

    return null;
  };

  /** Scroll a pane when the pointer sits near its edge, so long lists reachable. */
  const runAutoScroll = (py: number) => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    const pane = paneEl.current;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    let delta = 0;
    if (py < rect.top + EDGE_BAND) delta = -Math.ceil((rect.top + EDGE_BAND - py) / 4);
    else if (py > rect.bottom - EDGE_BAND) delta = Math.ceil((py - (rect.bottom - EDGE_BAND)) / 4);
    if (delta === 0) return;

    const step = () => {
      pane.scrollBy(0, delta);
      autoScrollRef.current = requestAnimationFrame(step);
    };
    autoScrollRef.current = requestAnimationFrame(step);
  };

  const onEventPointerDown = (event: ReactPointerEvent<HTMLElement>, itemId: number) => {
    if (!enabled || event.button !== 0) return;
    // Let the card's own controls work without starting a drag.
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;

    const el = eventEls.current.get(itemId);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    const { width, height } = rect;
    const previousUserSelect = document.body.style.userSelect;

    let started = false;
    let target: DragTarget | null = null;

    const onPointerMove = (ev: PointerEvent) => {
      if (
        !started &&
        Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      if (!started) {
        started = true;
        document.body.style.userSelect = 'none';
      }
      target = computeTarget(ev.clientX, ev.clientY, itemId);
      runAutoScroll(ev.clientY);
      setDrag({
        itemId,
        width,
        height,
        offsetX,
        offsetY,
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        target,
      });
    };

    const onPointerUp = () => {
      teardown();
      if (started && target) onCommit(itemId, target);
      else if (!started) onClick?.(itemId);
      setDrag(null);
    };

    function teardown() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.body.style.userSelect = previousUserSelect;
      if (autoScrollRef.current !== null) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
      teardownRef.current = null;
    }

    teardownRef.current = teardown;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  return { drag, registerEvent, registerDayCard, registerPane, onEventPointerDown };
}
