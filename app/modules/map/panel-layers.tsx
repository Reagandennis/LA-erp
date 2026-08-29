'use client';

import { useRef, useState } from 'react';

import type { MapCategoryDto, MapLayerDto, MapStyle } from '@/lib/map-types';

import { formatBytes } from './map-format';
import { EmptyState, EyeToggle, SectionHeading, TrashButton, ghostButtonClass, inputClass, primaryButtonClass } from './panel-ui';
import StyleEditor from './style-editor';

export default function LayersPanel({
  layers,
  categories,
  activeLayerId,
  importing,
  onSetActive,
  onToggleVisible,
  onRename,
  onRestyle,
  onDelete,
  onFit,
  onCreate,
  onImport,
}: Readonly<{
  layers: MapLayerDto[];
  categories: MapCategoryDto[];
  activeLayerId: number | null;
  importing: boolean;
  onSetActive: (id: number) => void;
  onToggleVisible: (layer: MapLayerDto) => void;
  onRename: (layer: MapLayerDto, name: string) => void;
  onRestyle: (layer: MapLayerDto, style: MapStyle) => void;
  onDelete: (layer: MapLayerDto) => void;
  onFit: (layer: MapLayerDto) => void;
  onCreate: (name: string) => void;
  onImport: (file: File, categoryId: number | null) => void;
}>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [importCategory, setImportCategory] = useState<number | null>(null);

  // Boundary overlays live on their own tab; this list is imports and drawings.
  const visible = layers.filter((layer) => layer.kind !== 'boundary');

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onImport(file, importCategory);
  };

  return (
    <div className="space-y-3 p-3">
      <SectionHeading>Import</SectionHeading>

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".kmz,.kml,.csv"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            e.target.value = '';
            pick(files);
          }}
        />
        <button
          type="button"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files);
          }}
          className={`w-full rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
            dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-500 hover:border-primary/40'
          } disabled:opacity-50`}
        >
          {importing ? (
            'Importing…'
          ) : (
            <>
              <span className="block font-semibold text-gray-700">Drop a .kmz, .kml or .csv</span>
              <span className="mt-0.5 block text-xs text-gray-400">or click to choose a file</span>
            </>
          )}
        </button>
        {categories.length > 0 && (
          <select
            value={importCategory ?? ''}
            onChange={(e) => setImportCategory(e.target.value ? Number(e.target.value) : null)}
            className={`${inputClass} mt-2`}
            aria-label="Category for imported layer"
          >
            <option value="">Category from the file</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                Force everything into {category.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <SectionHeading>Layers</SectionHeading>

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              onCreate(newName.trim());
              setNewName('');
            }
          }}
          placeholder="New drawing layer"
          className={inputClass}
        />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() => {
            onCreate(newName.trim());
            setNewName('');
          }}
          className={primaryButtonClass}
        >
          Add
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState>No layers yet. Import a file or add a drawing layer.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((layer) => {
            const isActive = layer.id === activeLayerId;
            const isOpen = expanded === layer.id;
            return (
              <li key={layer.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                <div className="flex items-center gap-1.5 px-2 py-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: layer.style.fill, borderColor: layer.style.stroke }}
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : layer.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">{layer.name}</span>
                    <span className="block truncate text-[11px] text-gray-400">
                      {layer.kind === 'drawn' ? 'Drawing' : layer.source?.toUpperCase()} · {layer.featureCount} feature
                      {layer.featureCount === 1 ? '' : 's'}
                      {layer.fileSize ? ` · ${formatBytes(layer.fileSize)}` : ''}
                    </span>
                  </button>
                  <EyeToggle on={layer.visible} onClick={() => onToggleVisible(layer)} label={`Show or hide ${layer.name}`} />
                </div>

                {isOpen && (
                  <div className="space-y-3 border-t border-gray-50 bg-gray-50/60 p-3">
                    <input
                      defaultValue={layer.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== layer.name) onRename(layer, name);
                      }}
                      className={inputClass}
                      aria-label="Layer name"
                    />

                    <StyleEditor value={layer.style} onChange={(style) => onRestyle(layer, style)} />

                    <div className="flex flex-wrap items-center gap-2">
                      {layer.kind === 'drawn' && (
                        <button
                          type="button"
                          onClick={() => onSetActive(layer.id)}
                          className={isActive ? primaryButtonClass : ghostButtonClass}
                        >
                          {isActive ? 'Drawing here' : 'Draw here'}
                        </button>
                      )}
                      <button type="button" onClick={() => onFit(layer)} className={ghostButtonClass}>
                        Zoom to
                      </button>
                      {layer.fileName && (
                        <a
                          href={`/api/map/layers/${layer.id}/file`}
                          className={ghostButtonClass}
                          title={`Download ${layer.fileName}`}
                        >
                          Original file
                        </a>
                      )}
                      <span className="ml-auto">
                        <TrashButton onClick={() => onDelete(layer)} label={`Delete ${layer.name}`} />
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
