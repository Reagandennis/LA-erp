import { mapIconPath } from './map-icons';

/** The catalogue icon for a key, filled with the current text colour. */
export function MapIcon({ icon, className = 'h-4 w-4' }: Readonly<{ icon: string | null | undefined; className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={mapIconPath(icon)} />
    </svg>
  );
}
