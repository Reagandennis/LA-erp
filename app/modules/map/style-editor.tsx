'use client';

import type { MapStyle, StrokeDash } from '@/lib/map-types';

import { labelClass } from './panel-ui';

const DASHES: Array<{ value: StrokeDash; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

/** The border and fill controls, shared by layers, shapes and zones. */
export default function StyleEditor({
  value,
  onChange,
  showFill = true,
}: Readonly<{
  value: MapStyle;
  onChange: (style: MapStyle) => void;
  showFill?: boolean;
}>) {
  const set = (patch: Partial<MapStyle>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={labelClass}>Border</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.stroke}
              onChange={(e) => set({ stroke: e.target.value })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-white"
              aria-label="Border colour"
            />
            <input
              type="range"
              min={0}
              max={10}
              value={value.strokeWidth}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
              className="w-full accent-primary"
              aria-label="Border width"
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-500">{value.strokeWidth}px</span>
          </div>
        </div>

        {showFill && (
          <div>
            <span className={labelClass}>Fill</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.fill}
                onChange={(e) => set({ fill: e.target.value })}
                className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-white"
                aria-label="Fill colour"
              />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(value.fillOpacity * 100)}
                onChange={(e) => set({ fillOpacity: Number(e.target.value) / 100 })}
                className="w-full accent-primary"
                aria-label="Fill opacity"
              />
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-500">
                {Math.round(value.fillOpacity * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>

      <div>
        <span className={labelClass}>Border style</span>
        <nav className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
          {DASHES.map(({ value: dash, label }) => (
            <button
              key={dash}
              type="button"
              onClick={() => set({ strokeDash: dash })}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                value.strokeDash === dash ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
