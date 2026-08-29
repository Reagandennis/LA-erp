'use client';

/**
 * The map panels share a lot of chrome. Rather than copy the app's usual class
 * strings into six files, they live here — still local to the module, so nothing
 * about the wider design system changes.
 */

export const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

export const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400';

export const primaryButtonClass =
  'rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40';

export const ghostButtonClass =
  'rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40';

export const iconButtonClass =
  'rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40';

export function SectionHeading({ children, action }: Readonly<{ children: React.ReactNode; action?: React.ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pb-2 pt-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{children}</h3>
      {action}
    </div>
  );
}

export function EmptyState({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
      {children}
    </p>
  );
}

export function EyeToggle({
  on,
  onClick,
  label,
}: Readonly<{ on: boolean; onClick: () => void; label: string }>) {
  return (
    <button type="button" onClick={onClick} className={iconButtonClass} aria-label={label} aria-pressed={on} title={label}>
      <svg
        className={`h-4 w-4 ${on ? 'text-primary' : 'text-gray-300'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        {on ? (
          <>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
            <circle cx="12" cy="12" r="3" />
          </>
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.7a3 3 0 004.2 4.2M6.5 6.7C4 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M14 6a8.5 8.5 0 017.5 6s-.7 1.3-2 2.7" />
        )}
      </svg>
    </button>
  );
}

export function TrashButton({ onClick, label }: Readonly<{ onClick: () => void; label: string }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-1.5 text-gray-400 transition hover:bg-rose-50 hover:text-rose-600"
      aria-label={label}
      title={label}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5h6v2m-8 0l1 12h8l1-12" />
      </svg>
    </button>
  );
}
