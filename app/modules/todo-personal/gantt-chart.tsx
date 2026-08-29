'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { addDays, clampRange, dateKey, dayDiff, isoWeekday, parseDateKey } from '@/lib/date-grid';

import {
  barGeometry,
  columnToDate,
  resolveTaskDates,
  shiftColumns,
  snapDelta,
  todayLineOffset,
  type DragMode,
} from './gantt-model';

export interface GanttTask {
  id: string;
  title: string;
  status: string;
  priority: 'High' | 'Medium' | 'Low';
  startDateIso?: string | null;
  dueDateIso?: string | null;
}

export interface GanttChartProps {
  /** Already scope-filtered and board-ordered by the caller. */
  tasks: GanttTask[];
  /** Board column names, in board order — drives the legend. */
  columns: string[];
  columnColors: Record<string, string>;
  isTaskOverdue: (task: GanttTask) => boolean;
  onOpenTask: (taskId: string) => void;
  /** `startKey`/`dueKey` are `YYYY-MM-DD`. */
  onReschedule: (taskId: string, startKey: string, dueKey: string) => void;
}

/** `useLayoutEffect` logs a warning during Next's server render. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type Scale = 'day' | 'week' | 'month';

/**
 * Per-scale geometry. One column is always exactly one day at every scale —
 * only the pixel width changes — so the bar maths never has to special-case a
 * zoom level.
 *
 * `maxCols` is the hard stop that keeps a task dated decades out from
 * expanding the grid to tens of thousands of columns.
 */
const SCALES: Record<
  Scale,
  { label: string; px: number; padBefore: number; padAfter: number; maxCols: number }
> = {
  day: { label: 'Day', px: 44, padBefore: 3, padAfter: 5, maxCols: 90 },
  week: { label: 'Week', px: 18, padBefore: 7, padAfter: 14, maxCols: 370 },
  month: { label: 'Month', px: 6, padBefore: 14, padAfter: 30, maxCols: 1100 },
};

const SIDEBAR_W = 208;
const ROW_H = 48;
const MONTH_BAND_H = 28;
const DAY_ROW_H = 36;
/** Pointer travel below this is a click, not a drag — matches kanban-board. */
const DRAG_THRESHOLD = 5;
/** A one-day bar at Month scale is 6px; keep it clickable. */
const MIN_BAR_W = 10;

const PRIORITY_BAR_COLORS: Record<GanttTask['priority'], string> = {
  High: '#f43f5e',
  Medium: '#f59e0b',
  Low: '#38bdf8',
};
const FALLBACK_BAR_COLOR = '#94a3b8';

interface DragState {
  taskId: string;
  mode: DragMode;
  originX: number;
  /** Column delta, snapped. */
  deltaCols: number;
  moved: boolean;
}

/** A task resolved onto the timeline. */
interface Placed {
  task: GanttTask;
  /** Column index of the first day, relative to the window. May be negative. */
  startCol: number;
  /** Column index of the last day, inclusive. May exceed the window. */
  endCol: number;
  /** True when the task has no stored start date and renders as a milestone. */
  isMilestone: boolean;
  color: string;
  overdue: boolean;
}

function formatKey(date: Date): string {
  return dateKey(date);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function describeRange(startKey: string, dueKey: string): string {
  const start = parseDateKey(startKey);
  const due = parseDateKey(dueKey);
  if (!start || !due) return '';
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return startKey === dueKey ? fmt(due) : `${fmt(start)} to ${fmt(due)}`;
}

export default function GanttChart({
  tasks,
  columns,
  columnColors,
  isTaskOverdue,
  onOpenTask,
  onReschedule,
}: GanttChartProps) {
  const [scale, setScale] = useState<Scale>('day');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const geometry = SCALES[scale];

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setTrackWidth(Math.max(0, node.clientWidth - SIDEBAR_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return now;
  }, []);

  /**
   * Resolve each task's start/due into local dates. `dueDateIso` only — the
   * `dueDate` field elsewhere in this module is a `toLocaleDateString()`
   * display string, and parsing that yields Invalid Date outside en-US.
   */
  const { scheduled, unscheduled } = useMemo(() => {
    const withDates: Array<{ task: GanttTask; start: Date; due: Date; isMilestone: boolean }> = [];
    const without: GanttTask[] = [];

    for (const task of tasks) {
      const resolved = resolveTaskDates(task.startDateIso, task.dueDateIso);
      if (!resolved) {
        without.push(task);
        continue;
      }
      withDates.push({ task, ...resolved });
    }
    return { scheduled: withDates, unscheduled: without };
  }, [tasks]);

  const viewWindow = useMemo(() => {
    let min = today;
    let max = today;
    for (const { start, due } of scheduled) {
      if (dayDiff(start, min) > 0) min = start;
      if (dayDiff(max, due) > 0) max = due;
    }
    const clamped = clampRange(
      addDays(min, -geometry.padBefore),
      addDays(max, geometry.padAfter),
      geometry.maxCols,
    );

    // Grow the window into any unused width rather than leaving the card
    // half empty. More calendar context reads better than fatter columns.
    const fitCols = Math.floor(trackWidth / geometry.px);
    if (fitCols > clamped.days) {
      const days = Math.min(fitCols, geometry.maxCols);
      return { ...clamped, days, end: addDays(clamped.start, days - 1) };
    }
    return clamped;
  }, [scheduled, today, geometry, trackWidth]);

  const cols = viewWindow.days;
  /**
   * Stretch the columns across whatever remains, so the track ends flush with
   * the card instead of leaving a sliver. Every consumer reads this same
   * value, so a fractional width stays consistent between the header cells and
   * the absolutely-positioned bars.
   */
  const pxPerDay =
    trackWidth > 0 && cols * geometry.px < trackWidth ? trackWidth / cols : geometry.px;
  const gridWidth = cols * pxPerDay;

  const placed = useMemo<Placed[]>(
    () =>
      scheduled.map(({ task, start, due, isMilestone }) => ({
        task,
        startCol: dayDiff(viewWindow.start, start),
        endCol: dayDiff(viewWindow.start, due),
        isMilestone,
        color:
          columnColors[task.status] ?? PRIORITY_BAR_COLORS[task.priority] ?? FALLBACK_BAR_COLOR,
        overdue: isTaskOverdue(task),
      })),
    [scheduled, viewWindow.start, columnColors, isTaskOverdue],
  );

  const beyondRange = placed.filter((p) => p.startCol > cols - 1 || p.endCol < 0).length;
  const todayCol = dayDiff(viewWindow.start, today);
  const todayVisible = todayCol >= 0 && todayCol < cols;

  /** Month runs for the header band. */
  const monthBands = useMemo(() => {
    const bands: Array<{ key: string; label: string; span: number }> = [];
    for (let i = 0; i < cols; i += 1) {
      const date = addDays(viewWindow.start, i);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const last = bands[bands.length - 1];
      if (last && last.key === key) last.span += 1;
      else bands.push({ key, label: monthLabel(date), span: 1 });
    }
    return bands;
  }, [viewWindow.start, cols]);

  /** Day header cells. Skipped at Month scale, where the band is enough. */
  const dayCells = useMemo(() => {
    if (scale === 'month') return [];
    return Array.from({ length: cols }, (_, i) => addDays(viewWindow.start, i));
  }, [scale, viewWindow.start, cols]);

  const scrollToToday = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !todayVisible) return;
    const target = SIDEBAR_W + todayCol * pxPerDay - (node.clientWidth - SIDEBAR_W) / 2;
    node.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [todayVisible, todayCol, pxPerDay]);

  // Centre on today on mount and whenever the zoom changes the geometry.
  useIsomorphicLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !todayVisible) return;
    const target = SIDEBAR_W + todayCol * pxPerDay - (node.clientWidth - SIDEBAR_W) / 2;
    node.scrollLeft = Math.max(0, target);
  }, [scale, todayVisible, todayCol, pxPerDay]);

  // ── Drag to reschedule ────────────────────────────────────────────────────

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    taskId: string,
    mode: DragMode,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ taskId, mode, originX: event.clientX, deltaCols: 0, moved: false });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag;
    if (!current) return;
    const travel = event.clientX - current.originX;
    const deltaCols = snapDelta(travel, pxPerDay);
    const moved = current.moved || Math.abs(travel) > DRAG_THRESHOLD;
    if (deltaCols === current.deltaCols && moved === current.moved) return;
    setDrag({ ...current, deltaCols, moved });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>, entry: Placed) => {
    const current = drag;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current || current.taskId !== entry.task.id) return;

    // A press that never travelled is a click: keep the original open-drawer
    // behaviour rather than writing an identical date back to the server.
    if (!current.moved && current.deltaCols === 0) {
      onOpenTask(entry.task.id);
      return;
    }
    if (current.deltaCols === 0) return;

    const next = applyDelta(entry, current.mode, current.deltaCols);
    onReschedule(entry.task.id, next.startKey, next.dueKey);
    setAnnouncement(`${entry.task.title} moved to ${describeRange(next.startKey, next.dueKey)}`);
  };

  /**
   * Translate a column delta into date keys. Goes through the same
   * `shiftColumns` the live preview uses, so the bar can never save something
   * other than where it was dropped.
   */
  const applyDelta = (entry: Placed, mode: DragMode, deltaCols: number) => {
    const next = shiftColumns(entry, mode, deltaCols);
    return {
      startKey: formatKey(columnToDate(viewWindow.start, next.startCol)),
      dueKey: formatKey(columnToDate(viewWindow.start, next.endCol)),
    };
  };

  const nudge = (event: ReactKeyboardEvent<HTMLElement>, entry: Placed) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = applyDelta(entry, event.shiftKey ? 'resize-end' : 'move', step);
    onReschedule(entry.task.id, next.startKey, next.dueKey);
    setAnnouncement(`${entry.task.title} moved to ${describeRange(next.startKey, next.dueKey)}`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const weekendOffset = (isoWeekday(viewWindow.start) - 1) * pxPerDay;
  const gridBackground = {
    backgroundImage: [
      // Weekend shading (Sat/Sun of a Monday-first week).
      `repeating-linear-gradient(to right, transparent 0 ${pxPerDay * 5}px, rgba(148,163,184,0.10) ${pxPerDay * 5}px ${pxPerDay * 7}px)`,
      // One hairline per column.
      `repeating-linear-gradient(to right, rgba(148,163,184,0.22) 0 1px, transparent 1px ${pxPerDay}px)`,
    ].join(', '),
    backgroundPosition: `${-weekendOffset}px 0, 0 0`,
    backgroundSize: `${pxPerDay * 7}px 100%, ${pxPerDay}px 100%`,
  } as const;

  const legend = columns.length > 0 ? columns : Object.keys(columnColors);

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.2)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Timeline</h3>
          <p className="text-xs text-slate-500">
            Drag a bar to reschedule, or drag either edge to change its start or due date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
            {(Object.keys(SCALES) as Scale[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setScale(key)}
                aria-pressed={scale === key}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  scale === key ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {SCALES[key].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={scrollToToday}
            disabled={!todayVisible}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Today
          </button>
        </div>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
          {legend.map((name) => (
            <span key={name} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: columnColors[name] ?? FALLBACK_BAR_COLOR }}
              />
              {name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
            Overdue
          </span>
        </div>
      )}

      {(viewWindow.overflowDays > 0 || beyondRange > 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {beyondRange > 0 &&
            `${beyondRange} task${beyondRange === 1 ? ' falls' : 's fall'} outside this range. `}
          {scale === 'month'
            ? `The timeline is capped at ${cols} days, so dates beyond that aren't shown.`
            : 'Zoom out to bring them into view.'}
        </p>
      )}

      {/* Grid — one scroll container for both axes */}
      <div
        ref={scrollRef}
        className="relative max-h-[70vh] overflow-auto rounded-2xl border border-slate-100"
      >
        <div style={{ width: SIDEBAR_W + gridWidth }}>
          {/* Sticky header: month band + day row */}
          <div className="sticky top-0 z-30 flex bg-[#f8fafc]">
            <div
              className="sticky left-0 z-40 flex shrink-0 items-end border-r border-b border-slate-200 bg-[#f8fafc] px-4 pb-2"
              style={{ width: SIDEBAR_W, height: MONTH_BAND_H + (scale === 'month' ? 0 : DAY_ROW_H) }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Task
              </span>
            </div>
            <div style={{ width: gridWidth }}>
              <div className="flex border-b border-slate-100" style={{ height: MONTH_BAND_H }}>
                {monthBands.map((band) => (
                  <div
                    key={band.key}
                    className="flex shrink-0 items-center overflow-hidden border-r border-slate-200 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 last:border-r-0"
                    style={{ width: band.span * pxPerDay }}
                  >
                    <span className="truncate">{band.label}</span>
                  </div>
                ))}
              </div>
              {scale !== 'month' && (
                <div className="flex border-b border-slate-200" style={{ height: DAY_ROW_H }}>
                  {dayCells.map((date, index) => {
                    const isToday = index === todayCol;
                    const weekend = isoWeekday(date) >= 6;
                    return (
                      <div
                        key={index}
                        className={`flex shrink-0 flex-col items-center justify-center border-r border-slate-100 last:border-r-0 ${
                          isToday ? 'bg-indigo-50' : weekend ? 'bg-slate-50' : ''
                        }`}
                        style={{ width: pxPerDay }}
                      >
                        {scale === 'day' && (
                          <span
                            className={`text-[9px] font-medium uppercase ${
                              isToday ? 'text-indigo-400' : 'text-slate-400'
                            }`}
                          >
                            {date.toLocaleDateString(undefined, { weekday: 'short' })}
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold ${
                            isToday ? 'text-indigo-600' : 'text-slate-600'
                          }`}
                        >
                          {date.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {todayVisible && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-indigo-500"
                style={{ left: SIDEBAR_W + todayLineOffset(todayCol, pxPerDay) }}
              />
            )}

            {placed.map((entry) => {
              const isDragging = drag?.taskId === entry.task.id;
              const delta = isDragging ? drag.deltaCols : 0;
              const { startCol, endCol } =
                delta === 0 ? entry : shiftColumns(entry, drag!.mode, delta);

              const { offscreen, left, width, clippedLeft, clippedRight } = barGeometry(
                { startCol, endCol },
                cols,
                pxPerDay,
                MIN_BAR_W,
              );
              const background = entry.overdue ? '#f43f5e' : entry.color;
              const rangeLabel = describeRange(
                formatKey(columnToDate(viewWindow.start, startCol)),
                formatKey(columnToDate(viewWindow.start, endCol)),
              );

              return (
                <div key={entry.task.id} className="flex" style={{ height: ROW_H }}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(entry.task.id)}
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-2.5 border-r border-b border-slate-100 bg-white px-4 text-left transition-colors hover:bg-slate-50"
                    style={{ width: SIDEBAR_W }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: background }}
                    />
                    <span className="truncate text-[13px] font-medium text-slate-800">
                      {entry.task.title}
                    </span>
                  </button>

                  <div
                    className="relative shrink-0 border-b border-slate-100"
                    style={{ width: gridWidth, ...gridBackground }}
                  >
                    {!offscreen && (
                      <div
                        className="absolute inset-y-0 flex items-center py-2"
                        style={{ left, width }}
                      >
                        <div
                          className={`group relative flex h-full w-full items-center rounded-lg text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] ${
                            clippedLeft ? 'rounded-l-none' : ''
                          } ${clippedRight ? 'rounded-r-none' : ''} ${
                            isDragging ? 'opacity-80 ring-2 ring-indigo-400' : ''
                          }`}
                          style={{ backgroundColor: background }}
                        >
                          <button
                            type="button"
                            aria-label={`${entry.task.title}, ${rangeLabel}. Arrow keys move it a day; hold shift to change the due date.`}
                            title={`${entry.task.title} — ${rangeLabel}`}
                            className="absolute inset-0 cursor-grab touch-none rounded-lg active:cursor-grabbing"
                            onClick={(event) => {
                              if (event.detail === 0) onOpenTask(entry.task.id);
                            }}
                            onPointerDown={(event) => beginDrag(event, entry.task.id, 'move')}
                            onPointerMove={moveDrag}
                            onPointerUp={(event) => endDrag(event, entry)}
                            onPointerCancel={() => setDrag(null)}
                            onKeyDown={(event) => nudge(event, entry)}
                          />
                          {!clippedLeft && (
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none rounded-l-lg opacity-0 transition-opacity group-hover:bg-white/40 group-hover:opacity-100"
                              onPointerDown={(event) =>
                                beginDrag(event, entry.task.id, 'resize-start')
                              }
                              onPointerMove={moveDrag}
                              onPointerUp={(event) => endDrag(event, entry)}
                              onPointerCancel={() => setDrag(null)}
                            />
                          )}
                          {!clippedRight && (
                            <span
                              aria-hidden
                              className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none rounded-r-lg opacity-0 transition-opacity group-hover:bg-white/40 group-hover:opacity-100"
                              onPointerDown={(event) =>
                                beginDrag(event, entry.task.id, 'resize-end')
                              }
                              onPointerMove={moveDrag}
                              onPointerUp={(event) => endDrag(event, entry)}
                              onPointerCancel={() => setDrag(null)}
                            />
                          )}
                          {scale === 'day' && (
                            <span className="pointer-events-none truncate px-3 drop-shadow-sm">
                              {entry.isMilestone ? '◆ ' : ''}
                              {entry.task.title}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {placed.length === 0 && (
              <div className="flex h-32 items-center justify-center text-sm text-slate-400">
                No scheduled tasks to display on the timeline.
              </div>
            )}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <details className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            Unscheduled — {unscheduled.length}
          </summary>
          <p className="mt-1 mb-2 text-[11px] text-slate-500">
            These have no due date, so they can&apos;t be placed on the timeline yet.
          </p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700 transition-colors hover:bg-slate-100"
              >
                {task.title}
              </button>
            ))}
          </div>
        </details>
      )}

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
