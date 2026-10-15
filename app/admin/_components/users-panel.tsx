'use client';

import { useMemo, useState } from 'react';

import { isDormant, isNeverUsed } from '@/lib/admin-rules';
import { AvatarStatus, presenceOf, usePresence } from '@/app/ui/status-dot';

import { type AdminRole, type AdminUser, type UserQuickFilter, isAdminUser } from './admin-types';
import {
  Avatar,
  EmptyState,
  RoleBadge,
  SearchInput,
  StatusPill,
  inputClass,
  primaryButton,
  relativeTime,
} from './admin-ui';

export const QUICK_FILTERS: Record<UserQuickFilter, { label: string; test: (u: AdminUser, now: Date) => boolean }> = {
  'no-access': {
    label: "Can't open any module",
    test: (u) => u.status === 'active' && !isAdminUser(u) && u.modules.length === 0,
  },
  'never-signed-in': {
    label: 'Never used',
    test: (u, now) => u.status === 'active' && isNeverUsed(u.createdAt, u.lastSeenAt, now),
  },
  dormant: {
    label: 'Unused for 30+ days',
    test: (u, now) => u.status === 'active' && isDormant(u.lastSeenAt, now),
  },
};

function accessLabel(user: AdminUser): string {
  if (isAdminUser(user)) return 'Everything';
  const n = user.modules.length;
  return n === 0 ? 'No modules' : `${n} module${n === 1 ? '' : 's'}`;
}

export default function UsersPanel({
  users,
  roles,
  now,
  quickFilter,
  onQuickFilterChange,
  onOpenUser,
  onCreateUser,
}: {
  users: AdminUser[];
  roles: AdminRole[];
  now: number;
  quickFilter: UserQuickFilter | null;
  onQuickFilterChange: (filter: UserQuickFilter | null) => void;
  onOpenUser: (userId: number) => void;
  onCreateUser: () => void;
}) {
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState('');
  const presence = usePresence();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const at = new Date(now);
    return users.filter((u) => {
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (roleId && !u.roles.some((r) => String(r.id) === roleId)) return false;
      if (status && u.status !== status) return false;
      if (quickFilter && !QUICK_FILTERS[quickFilter].test(u, at)) return false;
      return true;
    });
  }, [users, search, roleId, status, quickFilter, now]);

  const filtering = Boolean(search || roleId || status || quickFilter);
  const clearFilters = () => {
    setSearch('');
    setRoleId('');
    setStatus('');
    onQuickFilterChange(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email…" className="flex-1 lg:max-w-sm" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={`${inputClass} sm:w-44`} aria-label="Filter by role">
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} sm:w-40`} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button type="button" onClick={onCreateUser} className={`${primaryButton} lg:ml-auto`}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New user
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span aria-live="polite">
          {filtering ? `Showing ${filtered.length} of ${users.length} people` : `${users.length} people`}
        </span>
        {quickFilter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 font-medium text-[#03458f]">
            {QUICK_FILTERS[quickFilter].label}
            <button
              type="button"
              onClick={() => onQuickFilterChange(null)}
              className="rounded-full p-0.5 hover:bg-blue-100"
              aria-label="Remove filter"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        )}
        {filtering && (
          <button type="button" onClick={clearFilters} className="font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <EmptyState
            title={filtering ? 'Nobody matches these filters' : 'No users yet'}
            detail={filtering ? 'Try a different search or clear the filters.' : 'Create the first account to get started.'}
          />
        ) : (
          <>
            {/* Wide screens: a table that scans down each column. */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-gray-100 bg-gray-50/60 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Person</th>
                  <th className="px-3 py-3 font-medium">Roles</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Access</th>
                  <th className="px-5 py-3 text-right font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => onOpenUser(u.id)}
                    className="cursor-pointer transition-colors hover:bg-gray-50/80"
                  >
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenUser(u.id);
                        }}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <AvatarStatus variant={presenceOf(presence, u.id)}>
                          <Avatar name={u.name} />
                        </AvatarStatus>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-gray-900">{u.name}</span>
                          <span className="block truncate text-xs text-gray-500">{u.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <RoleBadge key={r.id} name={r.name} isAdmin={r.name === 'admin'} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={u.status} />
                    </td>
                    <td className={`px-3 py-3 tabular-nums ${!isAdminUser(u) && u.modules.length === 0 ? 'text-amber-700' : 'text-gray-600'}`}>
                      {accessLabel(u)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">
                      <span title={u.lastSeenAt ? new Date(u.lastSeenAt).toISOString() : undefined}>{relativeTime(u.lastSeenAt, now)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phones: one card per person. */}
            <ul className="divide-y divide-gray-50 md:hidden">
              {filtered.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => onOpenUser(u.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
                    <AvatarStatus variant={presenceOf(presence, u.id)}>
                      <Avatar name={u.name} />
                    </AvatarStatus>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-gray-900">{u.name}</span>
                        <StatusPill status={u.status} />
                      </span>
                      <span className="block truncate text-xs text-gray-500">{u.email}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        {u.roles.map((r) => (
                          <RoleBadge key={r.id} name={r.name} isAdmin={r.name === 'admin'} />
                        ))}
                        <span className="ml-1 text-xs text-gray-500">
                          {accessLabel(u)} · {relativeTime(u.lastSeenAt, now)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
