'use client';

import { useEffect, useMemo, useState } from 'react';

import { AssignShiftModal, type EditingState } from './assign-shift-modal';
import { ScheduleDayTimeline } from './schedule-day-timeline';
import { ScheduleGrid } from './schedule-grid';
import { ScheduleMonth } from './schedule-month';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  LinkIcon,
  Printer,
  formatDateKey,
  generateDates,
  getStartOfWeek,
  type Position,
  type Shift,
  type ShiftBlock,
} from './schedule-shared';
import { useRoster } from './use-roster';

type ViewMode = 'month' | 'week' | 'day';

const noonToday = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
};

export function ScheduleTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [viewDays, setViewDays] = useState<7 | 14 | 28>(7);
  const [anchor, setAnchor] = useState<Date>(() => noonToday());
  const [positionFilter, setPositionFilter] = useState<Position>('All');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Week columns for the grid view.
  const weekDates = useMemo(
    () => generateDates(getStartOfWeek(anchor), viewDays),
    [anchor, viewDays],
  );

  // Fetch range for the shared roster hook, per view.
  const [from, to] = useMemo<[string, string]>(() => {
    if (viewMode === 'day') {
      const k = formatDateKey(anchor);
      return [k, k];
    }
    if (viewMode === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
      const cells = generateDates(getStartOfWeek(first), 42);
      return [formatDateKey(cells[0]), formatDateKey(cells[cells.length - 1])];
    }
    return [formatDateKey(weekDates[0]), formatDateKey(weekDates[weekDates.length - 1])];
  }, [viewMode, anchor, weekDates]);

  const { employees, loadingEmployees, roster, createShift, updateShift, deleteShift } = useRoster(from, to);

  const filteredEmployees = useMemo(() => {
    if (positionFilter === 'All') return employees;
    return employees.filter((e) => e.position === positionFilter);
  }, [employees, positionFilter]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.export-menu')) setExportMenuOpen(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // --- Navigation ---
  const step = (dir: -1 | 1) => {
    setAnchor((prev) => {
      const d = new Date(prev);
      if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
      else if (viewMode === 'day') d.setDate(d.getDate() + dir);
      else d.setDate(d.getDate() + dir * viewDays);
      return d;
    });
  };

  const rangeLabel = useMemo(() => {
    if (viewMode === 'month') return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (viewMode === 'day') return anchor.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const a = weekDates[0];
    const b = weekDates[weekDates.length - 1];
    return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }, [viewMode, anchor, weekDates]);

  // --- Shift editing wiring (shared by all views) ---
  const openAdd = (employeeId: string, dateKey: string) => {
    if (readOnly) return;
    setEditing({ dateKey, employeeId });
  };
  const openAddDay = (dateKey: string) => {
    if (readOnly) return;
    setEditing({ dateKey, pickEmployee: true });
  };
  const openEdit = (s: Shift) => {
    if (readOnly) return;
    setEditing({ dateKey: s.date, employeeId: s.employeeId, shiftId: s.id, shift: s });
  };
  const openDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    setAnchor(d);
    setViewMode('day');
  };

  const applyBlock = (block: ShiftBlock, employeeId: number) => {
    if (!editing) return;
    if (editing.shiftId != null) void updateShift(editing.shiftId, block);
    else void createShift(employeeId, editing.dateKey, block);
    setEditing(null);
  };
  const removeShift = (id: number) => {
    void deleteShift(id);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          {/* View switcher */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            {(['month', 'week', 'day'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-semibold rounded-md capitalize transition-colors ${
                  viewMode === mode ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50" aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setAnchor(noonToday())} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              Today
            </button>
            <button onClick={() => step(1)} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50" aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <span className="text-sm font-bold text-gray-900">{rangeLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as Position)}
              className="text-sm font-medium text-gray-700 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="All">All Positions</option>
              <option value="General Sales">General Sales</option>
              <option value="Commission Sales">Commission Sales</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Manager">Manager</option>
            </select>
          </div>

          {viewMode === 'week' && (
            <div className="flex rounded-lg bg-gray-100 p-1">
              {[7, 14, 28].map((days) => (
                <button
                  key={days}
                  onClick={() => setViewDays(days as 7 | 14 | 28)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    viewDays === days ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          )}

          <div className="relative export-menu">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExportMenuOpen(!exportMenuOpen);
              }}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              Export
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-gray-100 bg-white shadow-xl z-50 py-2">
                <button onClick={() => window.print()} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={() => alert('PDF Export simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Download className="w-4 h-4" /> Save as PDF
                </button>
                <button onClick={() => alert('Link copied to clipboard')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <LinkIcon className="w-4 h-4" /> Send as Link
                </button>
                <button onClick={() => alert('Google Sheets integration simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <FileSpreadsheet className="w-4 h-4" /> Google Sheets
                </button>
                <button onClick={() => alert('Google Drive integration simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Database className="w-4 h-4" /> Save to Drive
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active view */}
      {viewMode === 'month' && (
        <ScheduleMonth
          employees={filteredEmployees}
          roster={roster}
          monthAnchor={anchor}
          readOnly={readOnly}
          loadingEmployees={loadingEmployees}
          onAddDay={openAddDay}
          onEdit={openEdit}
          onOpenDay={openDay}
        />
      )}
      {viewMode === 'week' && (
        <ScheduleGrid
          employees={filteredEmployees}
          roster={roster}
          dates={weekDates}
          readOnly={readOnly}
          loadingEmployees={loadingEmployees}
          onAdd={openAdd}
          onEdit={openEdit}
        />
      )}
      {viewMode === 'day' && (
        <ScheduleDayTimeline
          employees={filteredEmployees}
          roster={roster}
          date={anchor}
          readOnly={readOnly}
          loadingEmployees={loadingEmployees}
          onAdd={openAdd}
          onEdit={openEdit}
        />
      )}

      {/* Assign / edit modal */}
      {!readOnly && editing && (
        <AssignShiftModal
          key={`${editing.dateKey}:${editing.shiftId ?? 'new'}:${editing.employeeId ?? ''}`}
          editing={editing}
          employees={employees}
          onApply={applyBlock}
          onDelete={removeShift}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
