import { describe, expect, it } from 'vitest';

import { dateKey, isoFromDateKey } from '../lib/date-grid';
import {
  barGeometry,
  columnToDate,
  resolveTaskDates,
  shiftColumns,
  snapDelta,
  todayLineOffset,
} from '../app/modules/todo-personal/gantt-model';

/** Local midday, so these assertions don't move with the runner's timezone. */
function at(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

const iso = (key: string) => isoFromDateKey(key)!;

describe('resolveTaskDates', () => {
  it('drops a task with no due date so it can go in the Unscheduled group', () => {
    expect(resolveTaskDates(iso('2026-08-20'), null)).toBeNull();
    expect(resolveTaskDates(null, null)).toBeNull();
  });

  it('renders a task with no start date as a one-day milestone', () => {
    const resolved = resolveTaskDates(null, iso('2026-08-28'))!;
    expect(resolved.isMilestone).toBe(true);
    expect(dateKey(resolved.start)).toBe('2026-08-28');
    expect(dateKey(resolved.due)).toBe('2026-08-28');
  });

  it('spans start to due when both are set', () => {
    const resolved = resolveTaskDates(iso('2026-08-24'), iso('2026-08-28'))!;
    expect(resolved.isMilestone).toBe(false);
    expect(dateKey(resolved.start)).toBe('2026-08-24');
  });

  it('clamps a start that sits after the due date instead of inverting', () => {
    const resolved = resolveTaskDates(iso('2026-09-10'), iso('2026-08-28'))!;
    expect(dateKey(resolved.start)).toBe('2026-08-28');
  });

  it('ignores a due date that is only a display string', () => {
    // `task.dueDate` elsewhere in the module is toLocaleDateString() output.
    expect(resolveTaskDates(null, '28/08/2026')).toBeNull();
  });
});

describe('barGeometry', () => {
  const COLS = 30;
  const PX = 40;

  it('makes a same-day task exactly one column wide', () => {
    const bar = barGeometry({ startCol: 3, endCol: 3 }, COLS, PX);
    expect(bar.left).toBe(120);
    expect(bar.width).toBe(PX);
  });

  it('is inclusive of the due day — a 5-day task is 5 columns', () => {
    const bar = barGeometry({ startCol: 2, endCol: 6 }, COLS, PX);
    expect(bar.width).toBe(5 * PX);
  });

  it('lands its right edge exactly on the due column edge', () => {
    // The property `mx-1` used to break: the bar never reached its due date.
    for (const [startCol, endCol] of [[0, 0], [0, 4], [3, 3], [7, 19], [29, 29]]) {
      const bar = barGeometry({ startCol, endCol }, COLS, PX);
      expect(bar.left + bar.width).toBe((endCol + 1) * PX);
    }
  });

  it('starts at zero for a task on the window\'s first day', () => {
    expect(barGeometry({ startCol: 0, endCol: 2 }, COLS, PX).left).toBe(0);
  });

  it('clips a task that overruns either end, keeping it visible', () => {
    const left = barGeometry({ startCol: -5, endCol: 3 }, COLS, PX);
    expect(left.offscreen).toBe(false);
    expect(left.left).toBe(0);
    expect(left.width).toBe(4 * PX);
    expect(left.clippedLeft).toBe(true);

    const right = barGeometry({ startCol: 27, endCol: 90 }, COLS, PX);
    expect(right.clippedRight).toBe(true);
    expect(right.left + right.width).toBe(COLS * PX);
  });

  it('reports a span entirely outside the window as offscreen', () => {
    expect(barGeometry({ startCol: -9, endCol: -2 }, COLS, PX).offscreen).toBe(true);
    expect(barGeometry({ startCol: 40, endCol: 44 }, COLS, PX).offscreen).toBe(true);
  });

  it('honours a minimum width so a one-day bar stays clickable when zoomed out', () => {
    // Month scale is 6px per day, which is too small to hit.
    expect(barGeometry({ startCol: 2, endCol: 2 }, COLS, 6, 10).width).toBe(10);
  });
});

describe('shiftColumns', () => {
  const span = { startCol: 5, endCol: 9 };

  it('moves both ends together, preserving duration', () => {
    expect(shiftColumns(span, 'move', 3)).toEqual({ startCol: 8, endCol: 12 });
    expect(shiftColumns(span, 'move', -5)).toEqual({ startCol: 0, endCol: 4 });
  });

  it('resizes one end only', () => {
    expect(shiftColumns(span, 'resize-start', -2)).toEqual({ startCol: 3, endCol: 9 });
    expect(shiftColumns(span, 'resize-end', 4)).toEqual({ startCol: 5, endCol: 13 });
  });

  it('bottoms out at a one-day bar rather than inverting the range', () => {
    expect(shiftColumns(span, 'resize-start', 99)).toEqual({ startCol: 9, endCol: 9 });
    expect(shiftColumns(span, 'resize-end', -99)).toEqual({ startCol: 5, endCol: 5 });
  });

  it('is a no-op for a zero delta', () => {
    expect(shiftColumns(span, 'move', 0)).toEqual(span);
  });
});

describe('snapDelta', () => {
  it('rounds, so half a column of travel already moves a day', () => {
    expect(snapDelta(0, 40)).toBe(0);
    expect(snapDelta(19, 40)).toBe(0);
    expect(snapDelta(21, 40)).toBe(1);
    expect(snapDelta(-21, 40)).toBe(-1);
    expect(snapDelta(140, 40)).toBe(4);
  });
});

describe('todayLineOffset', () => {
  it('centres the line in today\'s column, not on its left edge', () => {
    // The old code shaded the whole column but drew the line on the boundary.
    expect(todayLineOffset(0, 40)).toBe(20);
    expect(todayLineOffset(7, 40)).toBe(300);
  });
});

describe('columnToDate', () => {
  it('walks the window without drifting across a DST change', () => {
    // US DST begins 2026-03-08.
    expect(dateKey(columnToDate(at(2026, 3, 6), 4))).toBe('2026-03-10');
    expect(dateKey(columnToDate(at(2026, 8, 1), 0))).toBe('2026-08-01');
  });
});
