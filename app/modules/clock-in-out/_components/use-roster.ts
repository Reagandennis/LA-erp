'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ApiShiftBlock, Employee, Position, RosterState, ShiftBlock } from './schedule-shared';

type ApiEmployee = { id: number; name: string; position: string };

const SCHEDULE_URL = '/api/clock-in-out/schedule';

/**
 * Shared data layer for the schedule views: the employee list plus the roster
 * for a [from, to] date-key range, with create/update/delete mutations that
 * re-fetch on success. Polls every 20s so edits by other admins appear.
 */
export function useRoster(from: string, to: string) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [roster, setRoster] = useState<RosterState>({});

  useEffect(() => {
    fetch('/api/clock-in-out/employees', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { employees: [] }))
      .then((data) => {
        const list: ApiEmployee[] = data.employees || [];
        setEmployees(
          list.map((u) => ({
            id: String(u.id),
            name: u.name,
            position: (u.position as Position) || 'General Sales',
          })),
        );
      })
      .catch(() => {
        // ignore — views render their empty state
      })
      .finally(() => setLoadingEmployees(false));
  }, []);

  const reload = useCallback(async () => {
    if (!from || !to) return;
    try {
      const res = await fetch(`${SCHEDULE_URL}?from=${from}&to=${to}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        shifts?: Array<{ id: number; employeeId: number; date: string; block: ApiShiftBlock }>;
      };
      const next: RosterState = {};
      for (const s of data.shifts ?? []) {
        const key = String(s.employeeId);
        if (!next[key]) next[key] = {};
        if (!next[key][s.date]) next[key][s.date] = [];
        next[key][s.date].push({
          id: s.id,
          employeeId: key,
          date: s.date,
          type: s.block.type,
          startTime: s.block.startTime ?? undefined,
          endTime: s.block.endTime ?? undefined,
          timeLabel: s.block.timeLabel ?? undefined,
          statusLabel: s.block.statusLabel ?? undefined,
          role: s.block.role ?? undefined,
          location: s.block.location ?? undefined,
          breakMinutes: s.block.breakMinutes ?? undefined,
          note: s.block.note ?? undefined,
          tasksCompleted: s.block.tasksCompleted ?? undefined,
          totalTasks: s.block.totalTasks ?? undefined,
        });
      }
      setRoster(next);
    } catch {
      // ignore
    }
  }, [from, to]);

  useEffect(() => {
    // reload fetches, then setState after the await — not a synchronous
    // effect update, so this rule is a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const id = setInterval(() => void reload(), 20000);
    return () => clearInterval(id);
  }, [reload]);

  const createShift = useCallback(
    async (employeeId: number, date: string, block: ShiftBlock) => {
      try {
        await fetch(SCHEDULE_URL, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId, date, block }),
        });
      } catch {
        // the poll reconciles if this fails
      }
      await reload();
    },
    [reload],
  );

  const updateShift = useCallback(
    async (id: number, block: ShiftBlock) => {
      try {
        await fetch(SCHEDULE_URL, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, block }),
        });
      } catch {
        // ignore
      }
      await reload();
    },
    [reload],
  );

  const deleteShift = useCallback(
    async (id: number) => {
      try {
        await fetch(SCHEDULE_URL, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      } catch {
        // ignore
      }
      await reload();
    },
    [reload],
  );

  return { employees, loadingEmployees, roster, reload, createShift, updateShift, deleteShift };
}
