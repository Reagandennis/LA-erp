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
  CloseIcon,
  DotsIcon,
  type IconComponent,
  InboxIcon,
  InfoCircleIcon,
  PlusIcon,
  SortIcon,
} from '@/app/ui/icons';

export interface KanbanTask {
  id: string;
  title: string;
  description?: string | null;
  priority: 'High' | 'Medium' | 'Low';
  list: string;
  dueDate: string | null;
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
const COLUMN_WIDTH = 300;

const PRIORITY_META: Record<
  KanbanTask['priority'],
  { label: string; className: string }
> = {
  High: { label: 'High', className: 'bg-rose-50 text-rose-600 ring-rose-100' },
  Medium: { label: 'Medium', className: 'bg-amber-50 text-amber-600 ring-amber-100' },
  Low: { label: 'Low', className: 'bg-teal-50 text-teal-600 ring-teal-100' },
};

/**
 * Column empty states. Columns are user-defined, so the icon and copy are chosen
 * by matching the column name; anything unrecognised gets a neutral inbox state.
 */
function emptyStateFor(column: string): {
  icon: IconComponent;
  title: string;
  description: string;
} {
  const name = column.toLowerCase();

  if (/progress|doing|active|wip/.test(name)) {
    return {
      icon: ArrowPathIcon,
      title: 'Nothing in progress',
      description: 'Tasks being worked on appear here.',
    };
  }
  if (/review|qa|check/.test(name)) {
    return {
      icon: ClipboardCheckIcon,
      title: 'Nothing in review',
      description: 'Tasks awaiting your review appear here.',
    };
  }
  if (/done|complete|closed|shipped/.test(name)) {
    return {
      icon: CheckCircleIcon,
      title: 'Nothing done yet',
      description: 'Completed tasks appear here.',
    };
  }
  return {
    icon: InboxIcon,
    title: `${column} is empty`,
    description: 'Tasks pulled into this column appear here.',
  };
}

function tooltipFor(column: string) {
  return `Tasks currently sitting in ${column}.`;
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
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.Medium;

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            {task.id}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${priority.className}`}
          >
            {priority.label}
          </span>
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            {task.list}
          </span>
        </div>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Task actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className="rounded-lg p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <DotsIcon className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen();
                }}
                className="block w-full px-3 py-1.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                Open
              </button>
              {columns.filter((c) => c !== task.status).length > 0 && (
                <div className="my-1 border-t border-gray-100" />
              )}
              {columns
                .filter((column) => column !== task.status)
                .map((column) => (
                  <button
                    key={column}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onMove(column);
                    }}
                    className="block w-full truncate px-3 py-1.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    Move to {column}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-bold leading-snug text-gray-900">{task.title}</h4>
        {task.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">
            {task.description}
          </p>
        )}
      </div>

      {task.dueDate && (
        <p
          className={`flex items-center gap-1 text-[11px] font-bold ${
            overdue ? 'text-rose-600' : 'text-gray-400'
          }`}
        >
          {overdue ? (
            <AlertTriangleIcon className="h-3 w-3" />
          ) : (
            <CalendarIcon className="h-3 w-3" />
          )}
          Due {task.dueDate}
          {overdue && ' · Overdue'}
        </p>
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
    for (const column of columns) {
      map.set(column, []);
    }
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
  const computeTarget = (
    px: number,
    py: number,
    draggedId: string,
  ): DropTarget | null => {
    for (const [column, el] of Array.from(columnEls.current.entries())) {
      const r = el.getBoundingClientRect();
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) {
        continue;
      }

      const ids = (stateRef.current.tasksByColumn.get(column) ?? [])
        .filter((task) => task.id !== draggedId)
        .map((task) => task.id);

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

    if (moved.status !== target.column) {
      onMoveTask(id, target.column);
    }
    onOrderChange(next.map((task) => task.id));
  };

  const onCardPointerDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    // Let the card's own controls (the actions menu) handle the press.
    if ((event.target as HTMLElement).closest('button, [role="menuitem"], [role="menu"]')) {
      return;
    }

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
      if (
        !started &&
        Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      started = true;
      target = computeTarget(ev.clientX, ev.clientY, id);
      setDrag({
        id,
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
      teardownRef.current?.();
      if (started && target) {
        commitDrag(id, target);
      } else if (!started) {
        // A press that never became a drag is a click — open the task.
        onOpenTask(id);
      }
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

  const renderColumnCards = (column: string): ReactNode => {
    const columnTasks = tasksByColumn.get(column) ?? [];
    const visible = drag ? columnTasks.filter((t) => t.id !== drag.id) : columnTasks;
    const ghost = drag?.target?.column === column ? drag : null;

    if (visible.length === 0 && !ghost) {
      return null;
    }

    const nodes: ReactNode[] = visible.map((task) => (
      <div
        key={task.id}
        ref={registerCard(task.id)}
        onPointerDown={(event) => onCardPointerDown(event, task.id)}
        className="cursor-grab touch-none select-none rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      >
        <CardBody
          task={task}
          columns={columns}
          overdue={isTaskOverdue(task)}
          onOpen={() => onOpenTask(task.id)}
          onMove={(status) => onMoveTask(task.id, status)}
        />
      </div>
    ));

    if (ghost?.target) {
      const index = Math.min(ghost.target.index, nodes.length);
      nodes.splice(
        index,
        0,
        <div
          key="drag-ghost"
          style={{ height: ghost.height }}
          className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5"
        />,
      );
    }

    return <div className="flex flex-col gap-2">{nodes}</div>;
  };

  return (
    <div className="flex flex-col">
      {/* Board toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-primary">Task Board</h3>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
            {tasks.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Reset to due-date order"
            aria-label="Reset to due-date order"
            onClick={() => onOrderChange([])}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
          >
            <SortIcon className="h-4 w-4" />
            Reset order
          </button>
          <span className="h-6 w-px bg-gray-200" />
          <button
            type="button"
            onClick={() => onNewTaskInColumn(columns[0] ?? 'Backlog')}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            Add task
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="flex gap-4 overflow-x-auto py-4">
        {columns.map((column) => {
          const accent = columnColors[column] ?? '#6366f1';
          const columnTasks = tasksByColumn.get(column) ?? [];
          const isRenaming = column in renameDrafts;
          const emptyState = emptyStateFor(column);
          const EmptyIcon = emptyState.icon;

          return (
            <div
              key={column}
              style={{ flexBasis: COLUMN_WIDTH }}
              className="flex max-h-[70vh] shrink-0 flex-col overflow-hidden rounded-2xl bg-gray-50"
            >
              {/* Column header */}
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                    aria-label={`${column} status`}
                  />
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
                      className="w-28 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRenameDraftChange(column, column)}
                      title="Click to rename"
                      className="truncate text-sm font-bold text-gray-800 hover:text-primary"
                    >
                      {column}
                    </button>
                  )}
                  <span title={tooltipFor(column)} className="shrink-0 text-gray-300">
                    <InfoCircleIcon className="h-3.5 w-3.5" />
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs font-bold tabular-nums text-gray-400">
                    {columnTasks.length}
                  </span>
                  <input
                    type="color"
                    value={accent}
                    onChange={(event) => onColumnColorChange(column, event.target.value)}
                    className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0"
                    title="Column colour"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveColumn(column)}
                    title="Remove column"
                    aria-label={`Remove ${column}`}
                    className="rounded p-0.5 text-gray-300 hover:text-rose-500"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Column content */}
              <div
                ref={registerColumn(column)}
                className="min-h-[18rem] flex-1 overflow-y-auto p-2"
              >
                {renderColumnCards(column) ?? (
                  <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
                    <EmptyIcon className="h-7 w-7 text-gray-300" />
                    <p className="text-xs font-bold text-gray-500">{emptyState.title}</p>
                    <p className="text-[11px] leading-relaxed text-gray-400">
                      {emptyState.description}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onNewTaskInColumn(column)}
                className="m-2 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-gray-500 transition-colors hover:bg-white hover:text-primary"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                New task
              </button>
            </div>
          );
        })}

        {/* Add column */}
        <div style={{ flexBasis: COLUMN_WIDTH }} className="shrink-0">
          {showAddColumn ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4">
              <p className="text-xs font-bold text-gray-600">New column</p>
              <input
                value={newColumnName}
                onChange={(event) => onNewColumnNameChange(event.target.value)}
                placeholder="Column name…"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onAddColumn();
                }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex items-center gap-2">
                <label htmlFor="kanban-column-color" className="text-xs font-bold text-gray-500">
                  Colour
                </label>
                <input
                  id="kanban-column-color"
                  type="color"
                  value={newColumnColor}
                  onChange={(event) => onNewColumnColorChange(event.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-gray-200"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onShowAddColumnChange(false);
                    onNewColumnNameChange('');
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onAddColumn}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                >
                  Add column
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onShowAddColumnChange(true)}
              className="flex h-full min-h-56 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 text-xs font-bold text-gray-500 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary"
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
          style={{
            width: drag.width,
            transform: `translate(${drag.pointerX - drag.offsetX}px, ${
              drag.pointerY - drag.offsetY
            }px)`,
          }}
          className="pointer-events-none fixed left-0 top-0 z-[1000] cursor-grabbing rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
        >
          <CardBody
            task={draggedTask}
            columns={columns}
            overdue={isTaskOverdue(draggedTask)}
            onOpen={() => {}}
            onMove={() => {}}
          />
        </div>
      )}
    </div>
  );
}
