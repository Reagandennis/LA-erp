/**
 * Pure geometry and drag maths for the Gantt view.
 *
 * Kept free of React so it can be unit-tested directly — the bar arithmetic is
 * where this view went wrong before, so it is the part that needs pinning down.
 */

import { addDays, dayDiff, dayFromIso } from '@/lib/date-grid';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface ColumnSpan {
  /** Column index of the first day, relative to the window. May be negative. */
  startCol: number;
  /** Column index of the last day, inclusive. May exceed the window. */
  endCol: number;
}

export interface BarGeometry {
  /** The span falls entirely outside the window; draw nothing. */
  offscreen: boolean;
  left: number;
  width: number;
  clippedLeft: boolean;
  clippedRight: boolean;
}

/**
 * Resolve a task's stored timestamps onto the timeline.
 *
 * A task with no start date — every row predating the `startDate` column —
 * becomes a one-day milestone on its due date. A stored start after the due
 * date is clamped rather than inverted.
 */
export function resolveTaskDates(
  startDateIso: string | null | undefined,
  dueDateIso: string | null | undefined,
): { start: Date; due: Date; isMilestone: boolean } | null {
  const due = dayFromIso(dueDateIso);
  if (!due) return null;

  const storedStart = dayFromIso(startDateIso);
  const isMilestone = !storedStart;
  const start = storedStart && dayDiff(storedStart, due) >= 0 ? storedStart : due;
  return { start, due, isMilestone };
}

/**
 * Place a column span in pixels, clipping it to the visible window.
 *
 * The span is inclusive of both end days, so a task that starts and ends on
 * the same day is exactly one column wide, and the right edge lands exactly on
 * `(endCol + 1) * px` — the true right edge of the due-date column. The old
 * implementation inset the bar with `mx-1`, which meant it never reached that
 * edge and vanished entirely once the columns got narrow.
 */
export function barGeometry(
  span: ColumnSpan,
  cols: number,
  px: number,
  minWidth = 0,
): BarGeometry {
  const { startCol, endCol } = span;
  if (startCol > cols - 1 || endCol < 0) {
    return { offscreen: true, left: 0, width: 0, clippedLeft: false, clippedRight: false };
  }

  const visibleStart = Math.max(0, startCol);
  const visibleEnd = Math.min(cols - 1, endCol);
  return {
    offscreen: false,
    left: visibleStart * px,
    width: Math.max(minWidth, (visibleEnd - visibleStart + 1) * px),
    clippedLeft: startCol < 0,
    clippedRight: endCol > cols - 1,
  };
}

/**
 * Apply a column delta to a span.
 *
 * Both the live drag preview and the commit that follows it go through here,
 * so what you see when you release is always what gets saved. Resizing past
 * the opposite edge bottoms out at a one-day bar instead of inverting.
 */
export function shiftColumns(span: ColumnSpan, mode: DragMode, delta: number): ColumnSpan {
  const { startCol, endCol } = span;
  if (mode === 'move') {
    return { startCol: startCol + delta, endCol: endCol + delta };
  }
  if (mode === 'resize-start') {
    return { startCol: Math.min(startCol + delta, endCol), endCol };
  }
  return { startCol, endCol: Math.max(endCol + delta, startCol) };
}

/** Pointer travel to whole columns. Rounds, so half a column of drag moves one. */
export function snapDelta(travelPx: number, px: number): number {
  return Math.round(travelPx / px);
}

/**
 * Where the today line sits: the *centre* of today's column.
 *
 * The old code used the column's left edge while shading the whole column,
 * so the line was drawn on the boundary between yesterday and today.
 */
export function todayLineOffset(todayCol: number, px: number): number {
  return todayCol * px + px / 2;
}

/** Turn a window-relative column index back into a date. */
export function columnToDate(windowStart: Date, col: number): Date {
  return addDays(windowStart, col);
}
