'use client';

import { useState } from 'react';

import type { MapCategoryDto, MapGeofenceDto, MapStyle } from '@/lib/map-types';

import { MapIcon } from './map-icon';
import { EmptyState, EyeToggle, SectionHeading, TrashButton, ghostButtonClass, inputClass } from './panel-ui';
import StyleEditor from './style-editor';

export default function GeofencesPanel({
  geofences,
  categories,
  occupancy,
  deviceLabels,
  drawing,
  canDraw,
  onStartDraw,
  onToggleVisible,
  onRename,
  onRestyle,
  onSetCategory,
  onDelete,
  onFocusDevice,
  onZoomTo,
}: Readonly<{
  geofences: MapGeofenceDto[];
  categories: MapCategoryDto[];
  occupancy: Record<number, string[]>;
  deviceLabels: Record<string, string>;
  drawing: boolean;
  canDraw: boolean;
  onStartDraw: () => void;
  onToggleVisible: (fence: MapGeofenceDto) => void;
  onRename: (fence: MapGeofenceDto, name: string) => void;
  onRestyle: (fence: MapGeofenceDto, style: MapStyle) => void;
  onSetCategory: (fence: MapGeofenceDto, categoryId: number | null) => void;
  onDelete: (fence: MapGeofenceDto) => void;
  onFocusDevice: (device: string) => void;
  onZoomTo: (fence: MapGeofenceDto) => void;
}>) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-3 p-3">
      <SectionHeading>Geofences</SectionHeading>

      <button
        type="button"
        onClick={onStartDraw}
        disabled={!canDraw}
        title={canDraw ? undefined : 'Drawing needs a working map'}
        className={`w-full rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:opacity-40 ${
          drawing ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-primary text-white hover:opacity-90'
        }`}
      >
        {drawing ? 'Click the map to draw the zone…' : 'Draw a zone'}
      </button>

      <p className="px-1 text-[11px] leading-relaxed text-gray-400">
        Zones update on every location refresh, so the counts below are live.
      </p>

      {geofences.length === 0 ? (
        <EmptyState>No zones yet.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {geofences.map((fence) => {
            const inside = occupancy[fence.id] ?? [];
            const category = fence.categoryId !== null ? categories.find((c) => c.id === fence.categoryId) : undefined;
            const isOpen = expanded === fence.id;
            return (
              <li key={fence.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                <div className="flex items-center gap-1.5 px-2 py-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: category?.color ?? fence.style.stroke }}
                  >
                    <MapIcon icon={category?.icon} className="h-3 w-3" />
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : fence.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">{fence.name}</span>
                    <span className="block text-[11px] text-gray-400">
                      {fence.shape} ·{' '}
                      <span className={inside.length > 0 ? 'font-semibold text-emerald-600' : ''}>
                        {inside.length} inside
                      </span>
                    </span>
                  </button>
                  <EyeToggle on={fence.visible} onClick={() => onToggleVisible(fence)} label={`Show or hide ${fence.name}`} />
                </div>

                {inside.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-t border-gray-50 px-2 py-1.5">
                    {inside.map((device) => (
                      <button
                        key={device}
                        type="button"
                        onClick={() => onFocusDevice(device)}
                        className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                      >
                        {deviceLabels[device] ?? device}
                      </button>
                    ))}
                  </div>
                )}

                {isOpen && (
                  <div className="space-y-3 border-t border-gray-50 bg-gray-50/60 p-3">
                    <input
                      defaultValue={fence.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== fence.name) onRename(fence, name);
                      }}
                      className={inputClass}
                      aria-label="Zone name"
                    />

                    <select
                      value={fence.categoryId ?? ''}
                      onChange={(e) => onSetCategory(fence, e.target.value ? Number(e.target.value) : null)}
                      className={inputClass}
                      aria-label="Zone category"
                    >
                      <option value="">No category</option>
                      {categories
                        .filter((c) => c.scope !== 'device')
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>

                    <StyleEditor value={fence.style} onChange={(style) => onRestyle(fence, style)} />

                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => onZoomTo(fence)} className={ghostButtonClass}>
                        Zoom to
                      </button>
                      <span className="ml-auto">
                        <TrashButton onClick={() => onDelete(fence)} label={`Delete ${fence.name}`} />
                      </span>
                    </div>
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
