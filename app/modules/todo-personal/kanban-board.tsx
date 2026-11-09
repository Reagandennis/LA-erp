'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  AlertTriangleIcon,
  ArrowPathIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  DotsIcon,
  type IconComponent,
  InboxIcon,
  PlusIcon,
  SortIcon,
} from '@/app/ui/icons';
import { dayFromIso } from '@/lib/date-grid';

export interface KanbanTask {
  id: string;
  title: string;
  description?: string | null;
  priority: 'High' | 'Medium' | 'Low';
  list: string;
  dueDate: string | null;
  /** The due instant, when known; lets the card say "Today" or "Tomorrow". */
  dueDateIso?: string | null;
  status: string;
}

/** Where a dragged card will land: a column plus an insertion index within it. */
interface DropTarget {
  column: string;
  index: number;
}

/** Live state of an in-progress pointer drag. Coordinates are viewport-space. */
interface DragState {
  id: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  target: DropTarget | null;
}

// Pointer travel (px) before a press is promoted to a drag, so taps and clicks
// on card controls still register normally.
const DRAG_THRESHOLD = 5;
const COLUMN_WIDTH = 296;

/** Colours offered when adding or recolouring a column. */
const COLUMN_SWATCHES = ['#94a3b8', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6'];

const PRIORITY_META: Record<KanbanTask['priority'], { label: string; chip: string; bar: string }> = {
  High: { label: 'High', chip: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' },
  Medium: { label: 'Medium', chip: 'bg-amber-50 text-amber-700', bar: 'bg-amber-400' },
  Low: { label: 'Low', chip: 'bg-teal-50 text-teal-700', bar: 'bg-teal-400' },
};

/**
 * Column empty states. Columns are user-defined, so the icon and copy are chosen
 * by matching the column name; anything unrecognised gets a neutral inbox state.
 */
function emptyStateFor(column: string): { icon: IconComponent; title: string; description: string } {
  const name = column.toLowerCase();
  if (/progress|doing|active|wip/.test(name)) {
    return { icon: ArrowPathIcon, title: 'Nothing in progress', description: 'Drag a task here when you start on it.' };
  }
  if (/review|qa|check/.test(name)) {
    return { icon: ClipboardCheckIcon, title: 'Nothing to review', description: 'Tasks waiting on a check land here.' };
  }
  if (/done|complete|closed|shipped/.test(name)) {
    return { icon: CheckCircleIcon, title: 'Nothing done yet', description: 'Finished tasks land here.' };
  }
  return { icon: InboxIcon, title: 'Nothing here', description: `Drag a task into ${column}.` };
}

/** "Today", "Tomorrow", "Overdue 2d", "Thu 13 Nov", or the stored date text. */
function dueLabel(task: KanbanTask, overdue: boolean): string | null {
  if (!task.dueDate) return null;
  const due = dayFromIso(task.dueDateIso);
  if (!due) return task.dueDate;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (overdue && days < 0) return `Overdue ${-days}d`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Readable text colour for a chip tinted with the column colour. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(99,102,241,${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}

/** Closes a popover on an outside press or Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, close]);
}

// --- Card ----------------------------------------------------------------

function CardBody({
  task,
  columns,
  overdue,
  onOpen,
  onMove,
}: Readonly<{
  task: KanbanTask;
  columns: string[];
  overdue: boolean;
  onOpen: () => void;
  onMove: (status: string) => void;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, menuRef, () => setMenuOpen(false));
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.Medium;
  const due = dueLabel(task, overdue);
  const others = columns.filter((column) => column !== task.status);

  return (
    <div className="flex gap-3">
      <span className={`mt-0.5 w-1 shrink-0 self-stretch rounded-full ${priority.bar}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900">{task.title}</h4>
          <div ref={menuRef} className="relative -mr-1 -mt-1 shrink-0">
            <button
              type="button"
              aria-label="Task actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
              className={`rounded-lg p-1 text-gray-400 transition-opacity hover:bg-gray-100 hover:text-gray-700 ${menuOpen ? 'opacity-100' : 'md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'}`}
            >
              <DotsIcon className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen();
                  }}
                  className="block w-full px-3 py-1.5 text-left font-medium text-gray-800 hover:bg-gray-50"
                >
                  Open task
                </button>
                {others.length > 0 && (
                  <>
                    <div className="my-1 border-t border-gray-100" />
                    <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Move to</p>
                    {others.map((column) => (
                      <button
                        key={column}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onMove(column);
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                      >
                        {column}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{task.description}</p>}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`rounded-md px-1.5 py-0.5 font-semibold ${priority.chip}`}>{priority.label}</span>
          {task.list && task.list !== 'Personal' && (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{task.list}</span>
          )}
          {due && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${
                overdue ? 'bg-rose-50 text-rose-700' : due === 'Today' ? 'bg-primary/10 text-primary' : 'text-gray-500'
              }`}
            >
              {overdue ? <AlertTriangleIcon className="h-3 w-3" /> : <CalendarIcon className="h-3 w-3" />}
              {due}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-gray-300">{task.id}</span>
        </div>
      </div>
    </div>
  );
}

// --- Column header menu ----------------------------------------------------

function ColumnMenu({
  column,
  accent,
  onRename,
  onColor,
  onRemove,
}: Readonly<{ column: string; accent: string; onRename: () => void; onColor: (color: string) => void; onRemove: () => void }>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Options for ${column}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg p-1 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 ${open ? 'opacity-100' : 'md:opacity-0 md:group-hover/column:opacity-100 md:focus:opacity-100'}`}
      >
        <DotsIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-800 hover:bg-gray-50"
          >
            Rename column
          </button>
          <div className="my-1 border-t border-gray-100" />
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Colour</p>
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
            {COLUMN_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Colour ${swatch}`}
                onClick={() => onColor(swatch)}
                className={`h-5 w-5 rounded-full ring-2 ring-offset-1 transition ${accent.toLowerCase() === swatch ? 'ring-gray-700' : 'ring-transparent hover:ring-gray-300'}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
            <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)] ring-2 ring-transparent hover:ring-gray-300" title="Custom colour">
              <input type="color" value={accent} onChange={(e) => onColor(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom colour" />
            </label>
          </div>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50"
          >
            Remove column
          </button>
        </div>
      )}
    </div>
  );
}

// --- Board ---------------------------------------------------------------

export default function KanbanBoard({
  tasks,
  columns,
  columnColors,
  renameDrafts,
  showAddColumn,
  newColumnName,
  newColumnColor,
  isTaskOverdue,
  onOpenTask,
  onMoveTask,
  onOrderChange,
  onNewTaskInColumn,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onColumnColorChange,
  onRemoveColumn,
  onAddColumn,
  onShowAddColumnChange,
  onNewColumnNameChange,
  onNewColumnColorChange,
}: Readonly<{
  tasks: KanbanTask[];
  columns: string[];
  columnColors: Record<string, string>;
  renameDrafts: Record<string, string>;
  showAddColumn: boolean;
  newColumnName: string;
  newColumnColor: string;
  isTaskOverdue: (task: KanbanTask) => boolean;
  onOpenTask: (taskId: string) => void;
  onMoveTask: (taskId: string, status: string) => void;
  onOrderChange: (orderedIds: string[]) => void;
  onNewTaskInColumn: (column: string) => void;
  onRenameDraftChange: (column: string, value: string) => void;
  onRenameCommit: (column: string) => void;
  onRenameCancel: (column: string) => void;
  onColumnColorChange: (column: string, color: string) => void;
  onRemoveColumn: (column: string) => void;
  onAddColumn: () => void;
  onShowAddColumnChange: (value: boolean) => void;
  onNewColumnNameChange: (value: string) => void;
  onNewColumnColorChange: (value: string) => void;
}>) {
  const [drag, setDrag] = useState<DragState | null>(null);

  // Live element registries for pointer hit-testing (kept out of render state).
  // Registration uses React 19 ref-cleanup callbacks rather than a memo cache,
  // so nothing reads a ref during render.
  const columnEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const teardownRef = useRef<(() => void) | null>(null);

  const registerColumn = (column: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    columnEls.current.set(column, el);
    return () => {
      columnEls.current.delete(column);
    };
  };

  const registerCard = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    cardEls.current.set(id, el);
    return () => {
      cardEls.current.delete(id);
    };
  };

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, KanbanTask[]>();
    for (const column of columns) map.set(column, []);
    for (const task of tasks) {
      const bucket = map.get(task.status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [tasks, columns]);

  // Everything below reads the live task list through a ref so the pointer
  // handlers never close over a stale snapshot mid-drag.
  const stateRef = useRef({ tasks, tasksByColumn });
  useEffect(() => {
    stateRef.current = { tasks, tasksByColumn };
  }, [tasks, tasksByColumn]);

  /** Resolve a pointer position to a column + insertion index. */
  const computeTarget = (px: number, py: number, draggedId: string): DropTarget | null => {
    for (const [column, el] of Array.from(columnEls.current.entries())) {
      const r = el.getBoundingClientRect();
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;

      const ids = (stateRef.current.tasksByColumn.get(column) ?? []).filter((task) => task.id !== draggedId).map((task) => task.id);
      let index = ids.length;
      for (let i = 0; i < ids.length; i += 1) {
        const cardEl = cardEls.current.get(ids[i]);
        if (!cardEl) continue;
        const cr = cardEl.getBoundingClientRect();
        if (py < cr.top + cr.height / 2) {
          index = i;
          break;
        }
      }
      return { column, index };
    }
    return null;
  };

  /**
   * Rebuild the flat task list so the dragged card lands at the resolved slot
   * while every other card keeps its relative order, then publish both the new
   * status and the new board order.
   */
  const commitDrag = (id: string, target: DropTarget) => {
    const current = stateRef.current.tasks;
    const moved = current.find((task) => task.id === id);
    if (!moved) return;

    const rest = current.filter((task) => task.id !== id);
    const columnTasks = rest.filter((task) => task.status === target.column);
    const anchor = columnTasks[target.index];

    let next: KanbanTask[];
    if (anchor) {
      const at = rest.indexOf(anchor);
      next = [...rest.slice(0, at), moved, ...rest.slice(at)];
    } else {
      next = [...rest, moved];
    }

    if (moved.status !== target.column) onMoveTask(id, target.column);
    onOrderChange(next.map((task) => task.id));
  };

  const onCardPointerDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    // Let the card's own controls (the actions menu) handle the press.
    if ((event.target as HTMLElement).closest('button, [role="menuitem"], [role="menu"]')) return;

    const el = cardEls.current.get(id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    const { width, height } = rect;

    let started = false;
    let target: DropTarget | null = null;

    const onPointerMove = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      started = true;
      target = computeTarget(ev.clientX, ev.clientY, id);
      setDrag({ id, width, height, offsetX, offsetY, pointerX: ev.clientX, pointerY: ev.clientY, target });
    };

    const onPointerUp = () => {
      teardownRef.current?.();
      if (started && target) commitDrag(id, target);
      else if (!started) onOpenTask(id); // A press that never became a drag is a click.
      setDrag(null);
    };

    const teardown = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      teardownRef.current = null;
    };
    teardownRef.current = teardown;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const draggedTask = drag ? tasks.find((task) => task.id === drag.id) : undefined;
  const isDragging = drag !== null;

  // Suppress text selection while dragging.
  useEffect(() => {
    if (!isDragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [isDragging]);

  useEffect(() => () => teardownRef.current?.(), []);

  const overdueCount = tasks.filter((task) => isTaskOverdue(task)).length;

  const renderColumnCards = (column: string): ReactNode => {
    const columnTasks = tasksByColumn.get(column) ?? [];
    const visible = drag ? columnTasks.filter((t) => t.id !== drag.id) : columnTasks;
    const ghost = drag?.target?.column === column ? drag : null;
    if (visible.length === 0 && !ghost) return null;

    const nodes: ReactNode[] = visible.map((task) => {
      const overdue = isTaskOverdue(task);
      return (
        <div
          key={task.id}
          ref={registerCard(task.id)}
          onPointerDown={(event) => onCardPointerDown(event, task.id)}
          className={`group cursor-grab touch-none select-none rounded-xl border bg-white p-3 shadow-sm transition hover:-translate-y-px hover:shadow-md ${
            overdue ? 'border-rose-200' : 'border-gray-200/80 hover:border-gray-300'
          }`}
        >
          <CardBody task={task} columns={columns} overdue={overdue} onOpen={() => onOpenTask(task.id)} onMove={(status) => onMoveTask(task.id, status)} />
        </div>
      );
    });

    if (ghost?.target) {
      const index = Math.min(ghost.target.index, nodes.length);
      nodes.splice(index, 0, <div key="drag-ghost" style={{ height: ghost.height }} className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5" />);
    }
    return <div className="flex flex-col gap-2">{nodes}</div>;
  };

  return (
    <div className="flex flex-col">
      {/* Board toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
          <span aria-hidden="true">·</span>
          <span>{columns.length} columns</span>
          {overdueCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                <AlertTriangleIcon className="h-3.5 w-3.5" />
                {overdueCount} overdue
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Reset to due-date order"
            onClick={() => onOrderChange([])}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <SortIcon className="h-4 w-4" />
            Reset order
          </button>
          <button
            type="button"
            onClick={() => onNewTaskInColumn(columns[0] ?? 'Backlog')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            Add task
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-4 pt-1 [scrollbar-width:thin]">
        {columns.map((column) => {
          const accent = columnColors[column] ?? '#6366f1';
          const columnTasks = tasksByColumn.get(column) ?? [];
          const isRenaming = column in renameDrafts;
          const emptyState = emptyStateFor(column);
          const EmptyIcon = emptyState.icon;
          const isTarget = drag?.target?.column === column;

          return (
            <section
              key={column}
              aria-label={column}
              style={{ flexBasis: COLUMN_WIDTH, width: COLUMN_WIDTH }}
              className={`group/column flex max-h-[72vh] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-gray-50/80 transition-colors ${
                isTarget ? 'border-primary/40 bg-primary/[0.03]' : 'border-gray-200/80'
              }`}
            >
              <div className="h-1 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />

              {/* Column header */}
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDrafts[column]}
                      onChange={(event) => onRenameDraftChange(column, event.target.value)}
                      onBlur={() => onRenameCommit(column)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onRenameCommit(column);
                        if (event.key === 'Escape') onRenameCancel(column);
                      }}
                      className="w-36 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRenameDraftChange(column, column)}
                      title="Rename column"
                      className="truncate text-sm font-semibold text-gray-900 hover:text-primary"
                    >
                      {column}
                    </button>
                  )}
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                    style={{ backgroundColor: tint(accent, 0.15), color: accent }}
                  >
                    {columnTasks.length}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onNewTaskInColumn(column)}
                    title={`New task in ${column}`}
                    aria-label={`New task in ${column}`}
                    className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 md:opacity-0 md:group-hover/column:opacity-100 md:focus:opacity-100"
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                  <ColumnMenu
                    column={column}
                    accent={accent}
                    onRename={() => onRenameDraftChange(column, column)}
                    onColor={(color) => onColumnColorChange(column, color)}
                    onRemove={() => onRemoveColumn(column)}
                  />
                </div>
              </div>

              {/* Column content */}
              <div ref={registerColumn(column)} className="min-h-[14rem] flex-1 overflow-y-auto px-2 pb-1 [scrollbar-width:thin]">
                {renderColumnCards(column) ?? (
                  <div className="m-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 px-4 py-9 text-center">
                    <EmptyIcon className="h-6 w-6 text-gray-300" />
                    <p className="text-xs font-semibold text-gray-500">{emptyState.title}</p>
                    <p className="text-[11px] leading-relaxed text-gray-400">{emptyState.description}</p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onNewTaskInColumn(column)}
                className="mx-2 mb-2 mt-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-white hover:text-primary hover:shadow-sm"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                New task
              </button>
            </section>
          );
        })}

        {/* Add column */}
        <div style={{ flexBasis: COLUMN_WIDTH, width: COLUMN_WIDTH }} className="shrink-0 snap-start">
          {showAddColumn ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="h-1 -mx-4 -mt-4 rounded-t-2xl" style={{ backgroundColor: newColumnColor }} aria-hidden="true" />
              <p className="text-sm font-semibold text-gray-900">New column</p>
              <input
                value={newColumnName}
                onChange={(event) => onNewColumnNameChange(event.target.value)}
                placeholder="e.g. Waiting on client"
                autoFocus
                maxLength={40}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onAddColumn();
                  if (event.key === 'Escape') {
                    onShowAddColumnChange(false);
                    onNewColumnNameChange('');
                  }
                }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Colour</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLUMN_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      aria-label={`Colour ${swatch}`}
                      onClick={() => onNewColumnColorChange(swatch)}
                      className={`h-6 w-6 rounded-full ring-2 ring-offset-1 transition ${newColumnColor.toLowerCase() === swatch ? 'ring-gray-700' : 'ring-transparent hover:ring-gray-300'}`}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                  <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)] ring-2 ring-transparent hover:ring-gray-300" title="Custom colour">
                    <input id="kanban-column-color" type="color" value={newColumnColor} onChange={(event) => onNewColumnColorChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom colour" />
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onShowAddColumnChange(false);
                    onNewColumnNameChange('');
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onAddColumn}
                  disabled={!newColumnName.trim()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
                >
                  Add column
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onShowAddColumnChange(true)}
              className="flex h-full min-h-48 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-400 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary"
            >
              <PlusIcon className="h-4 w-4" />
              Add column
            </button>
          )}
        </div>
      </div>

      {/* Floating drag clone — ignores pointer events so hit-testing reads through it. */}
      {drag && draggedTask && (
        <div
          style={{ width: drag.width, transform: `translate(${drag.pointerX - drag.offsetX}px, ${drag.pointerY - drag.offsetY}px) rotate(1.5deg)` }}
          className="group pointer-events-none fixed left-0 top-0 z-[1000] cursor-grabbing rounded-xl border border-primary/30 bg-white p-3 shadow-2xl ring-4 ring-primary/10"
        >
          <CardBody task={draggedTask} columns={columns} overdue={isTaskOverdue(draggedTask)} onOpen={() => {}} onMove={() => {}} />
        </div>
      )}
    </div>
  );
}
