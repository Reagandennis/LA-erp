'use client';

import { useState } from 'react';

import type { CategoryScope, MapCategoryDto } from '@/lib/map-types';

import IconPicker from './icon-picker';
import { MapIcon } from './map-icon';
import { DEFAULT_MAP_ICON } from './map-icons';
import { EmptyState, EyeToggle, SectionHeading, TrashButton, ghostButtonClass, inputClass, labelClass, primaryButtonClass } from './panel-ui';

const SCOPES: Array<{ value: CategoryScope; label: string }> = [
  { value: 'both', label: 'Both' },
  { value: 'feature', label: 'Places' },
  { value: 'device', label: 'Devices' },
];

interface Draft {
  id: number | null;
  name: string;
  color: string;
  icon: string;
  scope: CategoryScope;
}

const BLANK: Draft = { id: null, name: '', color: '#03458f', icon: DEFAULT_MAP_ICON, scope: 'both' };

export default function CategoriesPanel({
  categories,
  hiddenCategoryIds,
  onToggleHidden,
  onSave,
  onDelete,
}: Readonly<{
  categories: MapCategoryDto[];
  hiddenCategoryIds: number[];
  onToggleHidden: (id: number) => void;
  onSave: (draft: Draft) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const hidden = new Set(hiddenCategoryIds);

  const submit = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      await onSave(draft);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 p-3">
      <SectionHeading
        action={
          <button type="button" onClick={() => setDraft(BLANK)} className="text-xs font-semibold text-primary hover:underline">
            New
          </button>
        }
      >
        Categories
      </SectionHeading>

      <p className="px-1 pb-1 text-[11px] leading-relaxed text-gray-400">
        A colour and icon you can pin onto imported places, drawn shapes, zones and tracked devices.
      </p>

      {draft && (
        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-3">
          <div>
            <label className={labelClass} htmlFor="category-name">
              Name
            </label>
            <input
              id="category-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Checkpoints"
              className={inputClass}
              autoFocus
            />
          </div>

          <div className="flex items-end gap-3">
            <div>
              <span className={labelClass}>Colour</span>
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white"
                aria-label="Category colour"
              />
            </div>
            <div className="flex-1">
              <span className={labelClass}>Applies to</span>
              <nav className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
                {SCOPES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDraft({ ...draft, scope: value })}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                      draft.scope === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <div>
            <span className={labelClass}>Icon</span>
            <IconPicker value={draft.icon} color={draft.color} onChange={(icon) => setDraft({ ...draft, icon })} />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className={ghostButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={saving || !draft.name.trim()} className={primaryButtonClass}>
              {draft.id ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {categories.length === 0 && !draft ? (
        <EmptyState>No categories yet. Create one to colour-code the map.</EmptyState>
      ) : (
        <ul className="divide-y divide-gray-50 overflow-hidden rounded-xl border border-gray-100">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center gap-2 bg-white px-2 py-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: category.color }}
              >
                <MapIcon icon={category.icon} className="h-3.5 w-3.5" />
              </span>
              <button
                type="button"
                onClick={() => setDraft({ ...category })}
                className="min-w-0 flex-1 text-left"
                title="Edit category"
              >
                <span className="block truncate text-sm font-medium text-gray-900">{category.name}</span>
                <span className="block text-[11px] text-gray-400">
                  {SCOPES.find((s) => s.value === category.scope)?.label}
                </span>
              </button>
              <EyeToggle
                on={!hidden.has(category.id)}
                onClick={() => onToggleHidden(category.id)}
                label={`Show or hide ${category.name}`}
              />
              <TrashButton onClick={() => void onDelete(category.id)} label={`Delete ${category.name}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type { Draft as CategoryDraft };
