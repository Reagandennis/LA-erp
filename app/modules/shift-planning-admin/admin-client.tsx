'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { MonthNav, Tabs } from '@/app/modules/_components/shift-ui';
import { useLiveRefresh } from '@/app/ui/use-live-refresh';
import { type AdminOverview, SHIFT_SOURCES } from '@/lib/shift-types';

import { getJson, message } from './api';
import AuditTab from './audit-tab';
import DashboardTab from './dashboard-tab';
import LeaveTab from './leave-tab';
import PeopleTab from './people-tab';
import RosterTab from './roster-tab';
import SettingsTab from './settings-tab';

type TabId = 'roster' | 'dashboard' | 'people' | 'leave' | 'settings' | 'audit';

export default function AdminClient({ initial }: { initial: AdminOverview }) {
  const [data, setData] = useState<AdminOverview>(initial);
  const [tab, setTab] = useState<TabId>('roster');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the last roster upload did; cleared when the scheduler moves to another month or tab. */
  const [flash, setFlash] = useState<string | null>(null);
  const month = data.month.month;

  // Only the newest request may land, so a slow answer never overwrites a later one.
  const latestLoad = useRef(0);

  /**
   * Re-reads everything for a month; every tab calls this after it saves.
   * `silent` is a background refresh: no dimming, and a failure is left for the next one.
   */
  const reload = async (target: string = month, silent = false) => {
    const id = (latestLoad.current += 1);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const next = await getJson<AdminOverview>(`/api/shift-planning/admin/overview?month=${target}`);
      if (id === latestLoad.current) setData(next);
    } catch (e) {
      if (!silent && id === latestLoad.current) setError(message(e, 'Could not load the roster.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Another scheduler saved, or a leave request came in: pull it in without a reload.
  // Unsaved changes on the roster stay in their tray; the checks rerun against the new data.
  useLiveRefresh(SHIFT_SOURCES, () => void reload(month, true));

  const pending = data.leaves.filter((l) => l.status === 'pending').length;
  const showsMonth = tab === 'roster';

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto max-w-[96rem]">
        <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Shift Planning Admin</h1>
            <p className="mt-1 text-sm text-gray-500">
              Build the roster from the rotation, cover absences, and publish it to staff.{' '}
              <Link href="/modules/shift-planning" className="font-semibold text-[#03458f] hover:underline">
                See what staff see →
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs<TabId>
              tabs={[
                { id: 'roster', label: 'Roster' },
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'people', label: 'People' },
                { id: 'leave', label: 'Leave', badge: pending },
                { id: 'settings', label: 'Rules & holidays' },
                { id: 'audit', label: 'Audit log' },
              ]}
              value={tab}
              onChange={(next) => {
                setFlash(null);
                setTab(next);
              }}
            />
            {showsMonth && <MonthNav month={month} onChange={(m) => { setFlash(null); void reload(m); }} disabled={loading} />}
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {tab === 'roster' && (
            <RosterTab
              key={month}
              data={data}
              reload={reload}
              onOpenPeople={() => setTab('people')}
              flash={flash}
              onImported={async (filled, summary) => {
                setFlash(summary);
                await reload(filled);
              }}
            />
          )}
          {tab === 'dashboard' && <DashboardTab onOpenLeave={() => setTab('leave')} />}
          {tab === 'people' && <PeopleTab data={data} reload={reload} />}
          {tab === 'leave' && <LeaveTab data={data} reload={reload} onOpenRoster={(m) => { setTab('roster'); void reload(m); }} />}
          {tab === 'settings' && <SettingsTab data={data} reload={reload} />}
          {tab === 'audit' && <AuditTab />}
        </div>
      </div>
    </div>
  );
}
