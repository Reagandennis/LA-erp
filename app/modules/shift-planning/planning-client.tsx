'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useBanner } from '@/app/ui/banner';

import BoardView from './board-view';
import ManageShiftsView from './manage-shifts-view';
import MonthView, { TemplateLegend } from './month-view';
import {
  addDays,
  atNoon,
  dateKey,
  formatRange,
  inputClass,
  monthGrid,
  rangeOfDays,
  startOfMonth,
  startOfWeek,
  type Holiday,
  type Leave,
  type LeaveType,
  type Person,
  type Shift,
  type ShiftTemplate,
  type Team,
} from './planning-shared';
import VacationsView, { LeaveLegend } from './vacations-view';

/**
 * Shift Planning.
 *
 * Three screens over one dataset — the board (who works when), vacations (who
 * is away) and shift patterns (the recurring templates behind it all). They
 * share a date anchor so moving through time in one keeps the others in step.
 */

type Screen = 'board' | 'vacations' | 'manage';
type Span = 'day' | 'week' | 'month';

const API = '/api/shift-planning';

export default function PlanningClient() {
  const banner = useBanner();

  const [screen, setScreen] = useState<Screen>('board');
  const [span, setSpan] = useState<Span>('week');
  const [anchor, setAnchor] = useState(() => atNoon(new Date()));
  const [templateFilter, setTemplateFilter] = useState('');

  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  const [leaveForm, setLeaveForm] = useState<{ date: string } | null>(null);
  const [shiftForm, setShiftForm] = useState<{ date: string; shift: Shift | null } | null>(null);

  /** Days on screen: one for the day view, the Monday-anchored week otherwise. */
  const days = useMemo(
    () => (span === 'day' ? [anchor] : rangeOfDays(startOfWeek(anchor), 7)),
    [anchor, span],
  );

  /** Month view paints its own grid, so it fetches the whole 42-cell span. */
  const showingMonth = screen === 'board' && span === 'month';

  /** Fetch window — the month grid when showing vacations, else the visible days. */
  const [from, to] = useMemo(() => {
    const window = screen === 'vacations' || showingMonth ? monthGrid(anchor) : days;
    return [dateKey(window[0]!), dateKey(window[window.length - 1]!)];
  }, [screen, showingMonth, anchor, days]);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`${API}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
          'x-silent-banner': '1',
        },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        banner.error('Shift planning', data?.error ?? 'That did not work.');
        return null;
      }
      return response;
    },
    [banner],
  );

  const loadStatic = useCallback(async () => {
    const [rosterRes, templatesRes] = await Promise.all([
      fetch(`${API}/roster`, { credentials: 'include' }),
      fetch(`${API}/templates`, { credentials: 'include' }),
    ]);
    if (rosterRes.ok) {
      const data = (await rosterRes.json()) as {
        people: Person[];
        teams: Team[];
        canManage: boolean;
      };
      setPeople(data.people);
      setTeams(data.teams);
      setCanManage(data.canManage);
    }
    if (templatesRes.ok) {
      const data = (await templatesRes.json()) as { templates: ShiftTemplate[] };
      setTemplates(data.templates);
    }
  }, []);

  /**
   * Load everything that depends on the visible date range.
   *
   * `isStale` lets the caller abandon a response that arrived after the user
   * moved on — without it, clicking through weeks quickly can land an older
   * response on top of a newer one.
   */
  const loadRange = useCallback(
    async (isStale: () => boolean = () => false) => {
      const query = `?from=${from}&to=${to}`;
      const [shiftsRes, leaveRes, holidaysRes] = await Promise.all([
        fetch(`${API}/shifts${query}`, { credentials: 'include' }),
        fetch(`${API}/leave${query}`, { credentials: 'include' }),
        fetch(`${API}/holidays${query}`, { credentials: 'include' }),
      ]);
      const [shiftData, leaveData, holidayData] = await Promise.all([
        shiftsRes.ok ? (shiftsRes.json() as Promise<{ shifts: Shift[] }>) : null,
        leaveRes.ok ? (leaveRes.json() as Promise<{ leave: Leave[] }>) : null,
        holidaysRes.ok ? (holidaysRes.json() as Promise<{ holidays: Holiday[] }>) : null,
      ]);
      if (isStale()) return;
      if (shiftData) setShifts(shiftData.shifts);
      if (leaveData) setLeave(leaveData.leave);
      if (holidayData) setHolidays(holidayData.holidays);
    },
    [from, to],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadStatic();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatic]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadRange(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRange]);

  // --- Navigation ----------------------------------------------------------

  const step = (direction: 1 | -1) => {
    if (screen === 'vacations' || showingMonth) {
      const next = startOfMonth(anchor);
      next.setMonth(next.getMonth() + direction);
      setAnchor(next);
      return;
    }
    setAnchor(addDays(anchor, direction * (span === 'day' ? 1 : 7)));
  };

  const periodLabel =
    screen === 'vacations' || showingMonth
      ? anchor.toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric' })
      : span === 'day'
        ? anchor.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : formatRange(days);

  // --- Mutations -----------------------------------------------------------

  const createTemplate = async () => {
    const name = window.prompt('Shift name (e.g. Morning)');
    if (!name?.trim()) return;
    const response = await call('/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        startTime: '09:00',
        endTime: '17:00',
        weekdays: [1, 2, 3, 4, 5],
        colour: ['blue', 'amber', 'violet', 'emerald'][templates.length % 4],
      }),
    });
    if (response) {
      banner.success('Shift created', `${name.trim()} · edit the times and days below`);
      await loadStatic();
    }
  };

  const updateTemplate = async (id: string, patch: Record<string, unknown>) => {
    if (await call(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })) {
      await loadStatic();
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm('Delete this shift pattern? Shifts already scheduled are kept.')) return;
    if (await call(`/templates/${id}`, { method: 'DELETE' })) await loadStatic();
  };

  const addMember = async (templateId: string, userId: number) => {
    if (await call(`/templates/${templateId}/members`, { method: 'POST', body: JSON.stringify({ userId }) })) {
      await loadStatic();
    }
  };

  const removeMember = async (templateId: string, userId: number) => {
    if (await call(`/templates/${templateId}/members?userId=${userId}`, { method: 'DELETE' })) {
      await loadStatic();
    }
  };

  const addTeamToTemplate = async (templateId: string, teamId: string) => {
    if (await call(`/templates/${templateId}/teams`, { method: 'POST', body: JSON.stringify({ teamId }) })) {
      await loadStatic();
    }
  };

  const removeTeamFromTemplate = async (templateId: string, teamId: string) => {
    if (await call(`/templates/${templateId}/teams?teamId=${teamId}`, { method: 'DELETE' })) {
      await loadStatic();
    }
  };

  const createTeam = async () => {
    const name = window.prompt('Team name (e.g. Electrical A)');
    if (!name?.trim()) return;
    const response = await call('/teams', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        colour: ['emerald', 'violet', 'amber', 'blue'][teams.length % 4],
      }),
    });
    if (response) {
      banner.success('Team created', name.trim());
      await loadStatic();
    }
  };

  const decideLeave = async (id: string, status: 'approved' | 'declined') => {
    if (await call(`/leave/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })) {
      banner.success('Leave updated', status === 'approved' ? 'Approved' : 'Declined');
      await loadRange();
    }
  };

  const deleteLeave = async (id: string) => {
    if (await call(`/leave/${id}`, { method: 'DELETE' })) await loadRange();
  };

  const deleteShift = async (id: number) => {
    if (await call(`/shifts/${id}`, { method: 'DELETE' })) {
      setShiftForm(null);
      await loadRange();
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-full items-center justify-center bg-gray-50/50 p-8">
        <p className="text-sm text-gray-400">Loading the schedule…</p>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-gray-50/50">
      <header className="border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl">Shift Planning</h1>
            <p className="text-xs text-gray-500">
              {people.length} {people.length === 1 ? 'person' : 'people'} · {templates.length}{' '}
              {templates.length === 1 ? 'pattern' : 'patterns'} · {teams.length}{' '}
              {teams.length === 1 ? 'team' : 'teams'}
              {!canManage && ' · view only'}
            </p>
          </div>

          <nav className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
            {(
              [
                ['board', 'Board'],
                ['vacations', 'Vacations'],
                ['manage', 'Manage shifts'],
              ] as Array<[Screen, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScreen(value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  screen === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-2.5 sm:px-6">
        {screen !== 'manage' ? (
          <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous"
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setAnchor(atNoon(new Date()))}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <span className="text-sm font-semibold text-gray-900">{periodLabel}</span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {screen === 'board' && (
                <>
                  <select
                    value={templateFilter}
                    onChange={(e) => setTemplateFilter(e.target.value)}
                    className="rounded-xl bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">All shifts</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <TemplateLegend templates={templates} />
                  <div className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
                    {(['day', 'week', 'month'] as Span[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSpan(value)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                          span === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {screen === 'vacations' && (
                <>
                  <LeaveLegend />
                  <button
                    type="button"
                    onClick={() => setLeaveForm({ date: dateKey(anchor) })}
                    className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    + Add leave
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => void createTeam()}
                  className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  + New team
                </button>
                <button
                  type="button"
                  onClick={() => void createTemplate()}
                  className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  + Create shift
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {screen === 'board' && showingMonth && (
        <MonthView
          anchor={anchor}
          people={people}
          shifts={shifts}
          leave={leave}
          holidays={holidays}
          templates={templates}
          templateFilter={templateFilter}
          canManage={canManage}
          onOpenDay={(day) => {
            setAnchor(day);
            setSpan('week');
          }}
          onAdd={(key) => setShiftForm({ date: key, shift: null })}
        />
      )}

      {screen === 'board' && !showingMonth && (
        <BoardView
          days={days}
          people={people}
          shifts={shifts}
          leave={leave}
          holidays={holidays}
          templates={templates}
          templateFilter={templateFilter}
          canManage={canManage}
          onAdd={(key) => setShiftForm({ date: key, shift: null })}
          onEdit={(shift) => setShiftForm({ date: shift.date, shift })}
        />
      )}

      {screen === 'vacations' && (
        <VacationsView
          anchor={anchor}
          leave={leave}
          holidays={holidays}
          canManage={canManage}
          onAdd={(key) => setLeaveForm({ date: key })}
          onDecide={(id, status) => void decideLeave(id, status)}
          onDelete={(id) => void deleteLeave(id)}
        />
      )}

      {screen === 'manage' && (
        <ManageShiftsView
          templates={templates}
          people={people}
          teams={teams}
          canManage={canManage}
          onCreate={() => void createTemplate()}
          onUpdate={(id, patch) => void updateTemplate(id, patch)}
          onDelete={(id) => void deleteTemplate(id)}
          onAddMember={(templateId, userId) => void addMember(templateId, userId)}
          onRemoveMember={(templateId, userId) => void removeMember(templateId, userId)}
          onAddTeam={(templateId, teamId) => void addTeamToTemplate(templateId, teamId)}
          onRemoveTeam={(templateId, teamId) => void removeTeamFromTemplate(templateId, teamId)}
        />
      )}

      {leaveForm && (
        <LeaveDialog
          people={people}
          canManage={canManage}
          initialDate={leaveForm.date}
          onClose={() => setLeaveForm(null)}
          onSubmit={async (payload) => {
            const response = await call('/leave', { method: 'POST', body: JSON.stringify(payload) });
            if (response) {
              banner.success('Leave recorded', canManage ? 'Approved' : 'Sent for approval');
              setLeaveForm(null);
              await loadRange();
            }
          }}
        />
      )}

      {shiftForm && canManage && (
        <ShiftDialog
          people={people}
          templates={templates}
          date={shiftForm.date}
          shift={shiftForm.shift}
          onClose={() => setShiftForm(null)}
          onDelete={shiftForm.shift ? () => void deleteShift(shiftForm.shift!.id) : undefined}
          onSubmit={async (payload) => {
            const response = shiftForm.shift
              ? await call(`/shifts/${shiftForm.shift.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ block: payload.block }),
                })
              : await call('/shifts', { method: 'POST', body: JSON.stringify(payload) });
            if (response) {
              setShiftForm(null);
              await loadRange();
            }
          }}
        />
      )}
    </main>
  );
}

// --- Dialogs ---------------------------------------------------------------

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

function LeaveDialog({
  people,
  canManage,
  initialDate,
  onClose,
  onSubmit,
}: {
  people: Person[];
  canManage: boolean;
  initialDate: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [userId, setUserId] = useState<string>('');
  const [type, setType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [note, setNote] = useState('');

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <Dialog title="Add leave">
        <div className="mt-4 space-y-3">
          {canManage && (
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Person</span>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className={`${inputClass} mt-1`}
              >
                <option value="">Me</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
              className={`${inputClass} mt-1`}
            >
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="casual">Casual</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">To</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Note</span>
            <input
              type="text"
              value={note}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() =>
              onSubmit({
                ...(userId ? { userId: Number(userId) } : {}),
                type,
                startDate,
                endDate,
                note: note.trim() || null,
              })
            }
            disabled={endDate < startDate}
            className="flex-1 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {canManage ? 'Add leave' : 'Request leave'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </Dialog>
    </>
  );
}

function ShiftDialog({
  people,
  templates,
  date,
  shift,
  onClose,
  onSubmit,
  onDelete,
}: {
  people: Person[];
  templates: ShiftTemplate[];
  date: string;
  shift: Shift | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const [employeeId, setEmployeeId] = useState<string>(
    shift ? String(shift.employeeId) : String(people[0]?.id ?? ''),
  );
  const [templateId, setTemplateId] = useState<string | null>(shift?.templateId ?? null);
  const [startTime, setStartTime] = useState(shift?.block.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(shift?.block.endTime ?? '17:00');
  const [role, setRole] = useState(shift?.block.role ?? '');
  const [location, setLocation] = useState(shift?.block.location ?? '');

  const applyTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id);
    if (!template) {
      setTemplateId(null);
      return;
    }
    setTemplateId(template.id);
    setStartTime(template.startTime);
    setEndTime(template.endTime);
    if (!role) setRole(template.name);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <Dialog title={shift ? 'Edit shift' : 'Add shift'}>
        <p className="mt-1 text-xs text-gray-500">{date}</p>
        <div className="mt-4 space-y-3">
          {!shift && (
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Person</span>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={`${inputClass} mt-1`}
              >
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.position}
                  </option>
                ))}
              </select>
            </label>
          )}

          {templates.length > 0 && (
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Use a pattern
              </span>
              <select
                value={templateId ?? ''}
                onChange={(e) => applyTemplate(e.target.value)}
                className={`${inputClass} mt-1`}
              >
                <option value="">Custom times…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.startTime}–{template.endTime}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Role</span>
            <input
              type="text"
              value={role}
              placeholder="e.g. Main water pump repair"
              onChange={(e) => setRole(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Location</span>
            <input
              type="text"
              value={location}
              placeholder="Optional"
              onChange={(e) => setLocation(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() =>
              onSubmit({
                employeeId: Number(employeeId),
                date,
                templateId,
                block: {
                  // Night shifts cross midnight, which is why end <= start is allowed.
                  type: startTime >= '17:00' || startTime < '05:00' ? 'work-night' : 'work-day',
                  startTime,
                  endTime,
                  role: role.trim() || null,
                  location: location.trim() || null,
                },
              })
            }
            disabled={!employeeId}
            className="flex-1 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {shift ? 'Save' : 'Add shift'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="mt-2 w-full rounded-xl px-3.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
          >
            Delete shift
          </button>
        )}
      </Dialog>
    </>
  );
}
