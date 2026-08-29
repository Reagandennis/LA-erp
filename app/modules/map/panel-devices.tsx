'use client';

import { useState } from 'react';

import type { MapCategoryDto, MapDeviceTagDto, TrackedDevice } from '@/lib/map-types';

import { MapIcon } from './map-icon';
import { freshnessDot, timeAgo } from './map-format';
import { EmptyState, SectionHeading, inputClass } from './panel-ui';

export default function DevicesPanel({
  devices,
  deviceTags,
  categories,
  now,
  loading,
  query,
  onQueryChange,
  total,
  onFocus,
  onAssign,
}: Readonly<{
  devices: TrackedDevice[];
  deviceTags: Record<string, MapDeviceTagDto>;
  categories: MapCategoryDto[];
  now: number;
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  /** Devices before the search filter, so the count can read "12 of 33". */
  total: number;
  onFocus: (device: string) => void;
  onAssign: (device: string, categoryId: number | null) => void;
}>) {
  const [open, setOpen] = useState<string | null>(null);
  const deviceCategories = categories.filter((c) => c.scope !== 'feature');

  const searching = query.trim().length > 0;

  if (loading && total === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="space-y-2 p-3">
      <SectionHeading>
        Devices ({searching ? `${devices.length} of ${total}` : total})
      </SectionHeading>

      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onQueryChange('');
          }}
          placeholder="Search name, IMEI or category"
          aria-label="Search devices"
          className={`${inputClass} py-2 pl-10 pr-9`}
        />
        {searching && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Clear search"
            title="Clear search"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      {searching && (
        <p className="px-1 text-[11px] text-gray-400">
          The map is showing only these {devices.length === 1 ? 'device' : 'devices'}.
        </p>
      )}

      {devices.length === 0 ? (
        <EmptyState>
          {searching ? `Nothing matches “${query.trim()}”.` : 'No devices sharing location yet.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gray-50 overflow-hidden rounded-xl border border-gray-100">
          {devices.map((device, i) => {
            const tag = deviceTags[device.key];
            const category = tag?.categoryId != null ? categories.find((c) => c.id === tag.categoryId) : undefined;
            const color = category?.color ?? '#03458f';
            return (
              <li key={device.key} className="bg-white">
                <div className="flex items-center gap-2.5 px-2 py-2">
                  <button
                    type="button"
                    onClick={() => setOpen(open === device.key ? null : device.key)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                    title="Change category"
                    aria-label={`Change category for ${device.name}`}
                  >
                    {category ? <MapIcon icon={tag?.icon ?? category.icon} className="h-3.5 w-3.5" /> : i + 1}
                  </button>
                  <button
                    type="button"
                    onClick={() => onFocus(device.key)}
                    className="min-w-0 flex-1 text-left"
                    title="Show on map"
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {tag?.label || device.name}
                    </span>
                    <span className="block truncate text-[11px] text-gray-400">
                      {timeAgo(device.at, now)}
                      {device.speedKph ? ` · ${Math.round(device.speedKph)} km/h` : ''}
                      {device.accuracy ? ` · ±${Math.round(device.accuracy)}m` : ''}
                      {category ? ` · ${category.name}` : ''}
                    </span>
                  </button>
                  <span
                    className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                    title={`Position from ${device.source === 'traccar' ? 'Traccar' : 'Zello'}`}
                  >
                    {device.source === 'traccar' ? 'GPS' : 'Zello'}
                  </span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${freshnessDot(device.at, now)}`} aria-hidden />
                </div>

                {open === device.key && (
                  <div className="flex flex-wrap gap-1 border-t border-gray-50 bg-gray-50/60 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        onAssign(device.key, null);
                        setOpen(null);
                      }}
                      className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                        tag?.categoryId == null ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      None
                    </button>
                    {deviceCategories.map((category2) => (
                      <button
                        key={category2.id}
                        type="button"
                        onClick={() => {
                          onAssign(device.key, category2.id);
                          setOpen(null);
                        }}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                          tag?.categoryId === category2.id
                            ? 'text-white'
                            : 'bg-white text-gray-600 hover:bg-gray-100'
                        }`}
                        style={tag?.categoryId === category2.id ? { backgroundColor: category2.color } : undefined}
                      >
                        <MapIcon icon={category2.icon} className="h-3 w-3" />
                        {category2.name}
                      </button>
                    ))}
                    {deviceCategories.length === 0 && (
                      <span className="px-1 py-1 text-xs text-gray-400">
                        Create a category first, on the Categories tab.
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
