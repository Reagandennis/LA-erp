'use client';

import { MAP_ICONS, MAP_ICON_KEYS } from './map-icons';
import { MapIcon } from './map-icon';

/** Grid of every catalogue icon, tinted with the colour it will actually render in. */
export default function IconPicker({
  value,
  color,
  onChange,
}: Readonly<{ value: string; color: string; onChange: (icon: string) => void }>) {
  return (
    <div className="grid grid-cols-8 gap-1 rounded-xl bg-gray-50 p-2">
      {MAP_ICON_KEYS.map((key) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={selected}
            title={MAP_ICONS[key].label}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              selected ? 'bg-white shadow-sm ring-2 ring-primary/40' : 'hover:bg-white'
            }`}
            style={{ color: selected ? color : '#6b7280' }}
          >
            <MapIcon icon={key} className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
