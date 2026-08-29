'use client';

import { useState } from 'react';

import type { MapLayerDto, MapStyle } from '@/lib/map-types';

import { EmptyState, EyeToggle, SectionHeading } from './panel-ui';
import StyleEditor from './style-editor';

/**
 * Borders in both senses: the reference-boundary layers you upload, and the
 * stroke and fill controls for every shape on the map.
 */
export default function BordersPanel({
  layers,
  onToggleVisible,
  onRestyle,
}: Readonly<{
  layers: MapLayerDto[];
  onToggleVisible: (layer: MapLayerDto) => void;
  onRestyle: (layer: MapLayerDto, style: MapStyle) => void;
}>) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const reference = layers.filter((layer) => layer.kind === 'boundary');
  const imported = layers.filter((layer) => layer.kind === 'import');

  const row = (layer: MapLayerDto) => {
    const isOpen = expanded === layer.id;
    return (
      <li key={layer.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="flex items-center gap-1.5 px-2 py-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full border-2"
            style={{ borderColor: layer.style.stroke, backgroundColor: layer.style.fill }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => setExpanded(isOpen ? null : layer.id)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-sm font-medium text-gray-900">{layer.name}</span>
            <span className="block text-[11px] text-gray-400">
              {layer.featureCount} feature{layer.featureCount === 1 ? '' : 's'}
            </span>
          </button>
          <EyeToggle
            on={layer.visible}
            onClick={() => onToggleVisible(layer)}
            label={`Show or hide ${layer.name}`}
          />
        </div>
        {isOpen && (
          <div className="border-t border-gray-50 bg-gray-50/60 p-3">
            <StyleEditor value={layer.style} onChange={(style) => onRestyle(layer, style)} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3 p-3">
      <SectionHeading>Reference borders</SectionHeading>
      <p className="px-1 text-[11px] leading-relaxed text-gray-400">
        Upload a boundary .kmz, .kml or .csv on the Layers tab to draw county, ward or concession
        outlines under everything else. Their stroke and fill are set here.
      </p>

      {reference.length === 0 ? (
        <EmptyState>No reference border layers yet.</EmptyState>
      ) : (
        <ul className="space-y-2">{reference.map(row)}</ul>
      )}

      <SectionHeading>Imported layers</SectionHeading>
      {imported.length === 0 ? (
        <EmptyState>Nothing imported yet.</EmptyState>
      ) : (
        <ul className="space-y-2">{imported.map(row)}</ul>
      )}
    </div>
  );
}
