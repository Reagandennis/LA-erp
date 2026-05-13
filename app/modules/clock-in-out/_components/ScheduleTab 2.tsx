/* eslint-disable react-hooks/purity */
'use client';

import { 
  ChevronDown, Filter, Printer, Download, Link as LinkIcon, 
  FileSpreadsheet, Database, CheckCircle2
} from 'lucide-react';

// --- Types ---
export type Position = 'All' | 'General Sales' | 'Commission Sales' | 'Manager' | 'Supervisor';

export type Employee = {
  id: string;
  name: string;
  avatar: string;
  position: Position;
};

export type ShiftType = 'work-day' | 'work-night' | 'vacation' | 'preference' | 'available' | 'empty';

export type ShiftBlock = {
  type: ShiftType;
  startTime?: string;
  endTime?: string;
  timeLabel?: string;
  statusLabel?: string;
  tasksCompleted?: number;
  totalTasks?: number;
};

type RosterState = Record<string, Record<string, ShiftBlock>>;

// --- API Fetch for Employees ---
import { useState, useEffect, useMemo } from 'react';

type ApiUser = {
  id: number;
  name: string;
  email: string;
  status: string;
  roles: { name: string }[];
  modules: { slug: string }[];
};

function hasSchedulePermission(user: ApiUser): boolean {
  // Example: Only users with the 'clock-in-out' module or 'admin' role
  return (
    user.modules.some((m) => m.slug === 'clock-in-out') ||
    user.roles.some((r) => r.name === 'admin')
  );
}

const SHIFT_OPTIONS: ShiftBlock[] = [
  { type: 'work-day', startTime: '13:00', endTime: '19:00', timeLabel: '1pm-7pm' },
  { type: 'work-night', startTime: '19:00', endTime: '01:00', timeLabel: '7pm-1am', tasksCompleted: 0, totalTasks: 5 },
  { type: 'work-day', startTime: '08:00', endTime: '13:00', timeLabel: '8am-1pm', tasksCompleted: 3, totalTasks: 5 },
  { type: 'available', statusLabel: 'Available' },
  { type: 'vacation', statusLabel: 'Unavailable\nVacation' },
  { type: 'preference', statusLabel: 'Prefers to work\n7pm-1am' },
  { type: 'preference', statusLabel: 'Prefers to work\nAll day' },
  { type: 'empty' },
];

const STORAGE_KEY = 'clock-in-out-schedule-v2';

// --- Helpers ---
const getStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(12, 0, 0, 0);
  return d;
};

const generateDates = (startDate: Date, count: number) => {
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const formatDateKey = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const calculateHours = (start?: string, end?: string) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let hrs = (eh + em/60) - (sh + sm/60);
  if (hrs < 0) hrs += 24; // overnight shift
  return hrs;
};

// --- Component ---


export function ScheduleTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [viewDays, setViewDays] = useState<7 | 14 | 28>(7);
  const [startDateStr, setStartDateStr] = useState(() => formatDateKey(getStartOfWeek(new Date())));
  const [positionFilter, setPositionFilter] = useState<Position>('All');
  const [roster, setRoster] = useState<RosterState>({});
  const [activeCell, setActiveCell] = useState<{ empId: string, dateKey: string } | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Fetch users from API
  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => res.json())
      .then((data) => {
        // Only include users with permission
        const users: ApiUser[] = data.users || [];
        const filtered = users.filter(hasSchedulePermission);
        // Map to Employee type for schedule
        setEmployees(
          filtered.map((u) => ({
            id: String(u.id),
            name: u.name,
            avatar: `https://i.pravatar.cc/150?u=${u.id}`,
            position: (u.roles[0]?.name as Position) || 'General Sales',
          }))
        );
      });
  }, []);

  // ...existing code...
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRoster(JSON.parse(saved));
    } catch (e) { console.error('Failed to load roster', e); }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  }, [roster]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.shift-selector')) {
        setActiveCell(null);
      }
      if (!(e.target as Element).closest('.export-menu')) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const startDate = new Date(startDateStr + 'T12:00:00');
  const dates = useMemo(() => generateDates(startDate, viewDays), [startDateStr, viewDays]);

  const filteredEmployees = useMemo(() => {
    if (positionFilter === 'All') return employees;
    return employees.filter(e => e.position === positionFilter);
  }, [employees, positionFilter]);

  const handleShiftChange = (empId: string, dateKey: string, block: ShiftBlock) => {
    setRoster(prev => {
      const newRoster = { ...prev };
      if (!newRoster[empId]) newRoster[empId] = {};
      
      if (block.type === 'empty') {
        delete newRoster[empId][dateKey];
      } else {
        newRoster[empId][dateKey] = block;
      }
      return newRoster;
    });
    setActiveCell(null);
  };

  const getShiftStyle = (block?: ShiftBlock) => {
    if (!block || block.type === 'empty') return 'hover:bg-slate-50/50 border border-transparent hover:border-gray-200 transition-colors cursor-pointer text-transparent';
    if (block.type === 'available') return 'text-gray-300 font-medium flex items-center justify-center cursor-pointer';
    if (block.type === 'vacation') return 'bg-red-50 text-red-500 border border-red-200 cursor-pointer';
    if (block.type === 'preference') return 'bg-teal-50/50 text-teal-600 border border-teal-200 cursor-pointer';
    if (block.timeLabel === '7pm-1am') return 'bg-[#bfe1ff] text-slate-800 cursor-pointer rounded-lg relative overflow-hidden';
    if (block.timeLabel === '1pm-7pm') return 'bg-[#fff0b3] text-slate-800 cursor-pointer rounded-lg relative overflow-hidden';
    if (block.timeLabel === '8am-1pm') return 'bg-[#d8b8ff] text-slate-800 cursor-pointer rounded-lg relative overflow-hidden';
    return 'bg-gray-100 text-slate-800 cursor-pointer';
  };



  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Schedule</h2>
          
          <div className="h-6 w-px bg-gray-200 mx-2" />
          
          {/* Position Filter */}
          <div className="relative flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select 
              value={positionFilter}
              onChange={e => setPositionFilter(e.target.value as Position)}
              className="text-sm font-medium text-gray-700 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="All">All Positions</option>
              <option value="General Sales">General Sales</option>
              <option value="Commission Sales">Commission Sales</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Manager">Manager</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Toggles */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            {[7, 14, 28].map(days => (
              <button
                key={days}
                onClick={() => setViewDays(days as 7|14|28)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  viewDays === days ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {days} Days
              </button>
            ))}
          </div>

          {/* Date Picker */}
          <input 
            type="date" 
            value={startDateStr}
            onChange={(e) => {
              const d = new Date(e.target.value + 'T12:00:00');
              if (!isNaN(d.getTime())) setStartDateStr(formatDateKey(getStartOfWeek(d)));
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />

          {/* Export Menu */}
          <div className="relative export-menu">
            <button 
              onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
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

      {/* Grid Container */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto custom-scrollbar relative">
          <table className="w-full border-collapse text-sm text-left whitespace-nowrap min-w-max">
            <thead>
              {/* Header Row */}
              <tr className="border-b border-gray-100">
                <th className="p-4 bg-white sticky left-0 z-20 w-[200px] min-w-[200px] border-r border-gray-100 shadow-[1px_0_0_0_#f3f4f6]">
                  <div className="flex items-center gap-2 text-gray-500 font-medium">
                    View by employee <ChevronDown className="w-3 h-3" />
                  </div>
                </th>
                
                {dates.map((d, i) => {
                  const isToday = formatDateKey(d) === formatDateKey(new Date());
                  return (
                    <th key={i} className="p-4 min-w-[140px] text-center relative font-medium">
                      <div className={`inline-flex items-center justify-center gap-1 ${isToday ? 'bg-blue-500 text-white px-3 py-1 rounded-full shadow-sm' : 'text-gray-500'}`}>
                        <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <span>{d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
                      </div>
                    </th>
                  );
                })}
                <th className="p-4 bg-gray-50 text-gray-500 font-medium text-center border-l border-gray-100">
                  Total Hours
                </th>
              </tr>
              

            </thead>
            
            <tbody className="divide-y divide-gray-100">
              {filteredEmployees.map((emp) => {
                let totalRowHours = 0;

                return (
                  <tr key={emp.id} className="hover:bg-slate-50/30 transition-colors">
                    {/* Employee Info Cell */}
                    <td className="p-4 bg-white sticky left-0 z-10 border-r border-gray-100 shadow-[1px_0_0_0_#f3f4f6] align-top">
                      <div className="flex items-center gap-3">
                        <img src={emp.avatar} alt={emp.name} className="w-10 h-10 rounded-full object-cover border border-gray-200" />
                        <div>
                          <div className="font-semibold text-gray-900">{emp.name}</div>
                          <div className="text-xs text-gray-400">{emp.position}</div>
                        </div>
                      </div>
                    </td>

                    {/* Shifts Cells */}
                    {dates.map((d, i) => {
                      const dateKey = formatDateKey(d);
                      const block = roster[emp.id]?.[dateKey];
                      const isActive = activeCell?.empId === emp.id && activeCell?.dateKey === dateKey;
                      
                      if (block) {
                        totalRowHours += calculateHours(block.startTime, block.endTime);
                      }

                      return (
                        <td 
                          key={`cell-${i}`} 
                          className="p-2 align-top relative shift-selector min-w-[140px]"
                        >
                          <div
                            className={`h-24 w-full rounded-xl p-3 flex flex-col justify-between transition-all ${getShiftStyle(block)} ${readOnly ? '' : 'cursor-pointer'}`}
                            {...(!readOnly ? { onClick: () => setActiveCell({ empId: emp.id, dateKey }) } : {})}
                          >
                            {!block || block.type === 'empty' ? (
                              <div className="w-full h-full opacity-0"></div>
                            ) : block.type === 'available' ? (
                              <div className="w-full h-full flex items-center justify-center opacity-50">Available</div>
                            ) : (
                              <>
                                <div className="font-semibold text-sm whitespace-pre-wrap leading-tight text-opacity-90">
                                  {block.timeLabel || block.statusLabel}
                                </div>
                                {block.totalTasks !== undefined && (
                                  <div className="flex items-center gap-1 text-[10px] font-medium opacity-70 mt-auto">
                                    <div className="w-3 h-3 rounded-full border border-current flex items-center justify-center border-opacity-50">
                                      {block.tasksCompleted === block.totalTasks && block.totalTasks > 0 ? <CheckCircle2 className="w-2 h-2" /> : null}
                                    </div>
                                    {block.tasksCompleted}/{block.totalTasks} shift tasks completed
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Block Picker Dropdown (only if not readOnly) */}
                          {!readOnly && isActive && (
                            <div className="absolute top-0 left-0 z-50 mt-12 grid w-64 grid-cols-1 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-2xl">
                              <div className="text-xs font-semibold text-gray-500 mb-2 px-2">Assign Shift</div>
                              <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar px-1">
                                {SHIFT_OPTIONS.map((opt, idx) => (
                                  <button
                                    key={idx}
                                    onClick={(e) => { e.stopPropagation(); handleShiftChange(emp.id, dateKey, opt); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                      opt.type === 'empty' ? 'hover:bg-red-50 text-red-600' : 'hover:bg-gray-100 text-gray-800'
                                    }`}
                                  >
                                    {opt.type === 'empty' ? 'Clear Shift' : (opt.timeLabel || opt.statusLabel?.replace('\n', ' '))}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Total Hours Cell */}
                    <td className="p-4 bg-gray-50 border-l border-gray-100 text-center align-middle">
                      <div className="font-bold text-gray-900 text-lg">{totalRowHours > 0 ? `${totalRowHours}h` : '-'}</div>
                      <div className="text-xs text-gray-400 mt-1">Total Time</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
