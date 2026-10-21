/**
 * The instant loading state for a module or admin screen: the page's frame
 * (title, summary tiles, a list) in placeholder grey, painted from the
 * prefetched shell the moment a sidebar link is clicked, before the server has
 * rendered the real page. `data-route-loading` lets tests tell it apart.
 */
export default function RouteSkeleton({ tiles = 4, rows = 8 }: { tiles?: number; rows?: number }) {
  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10" data-route-loading="" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6 lg:space-y-8">
        <div className="space-y-3">
          <div className="h-8 w-56 rounded-lg bg-gray-200" />
          <div className="h-4 w-80 max-w-full rounded bg-gray-100" />
        </div>
        {tiles > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {Array.from({ length: tiles }, (_, i) => (
              <div key={i} className="h-24 rounded-2xl border border-gray-100 bg-white" />
            ))}
          </div>
        )}
        <div className="h-14 rounded-2xl border border-gray-100 bg-white" />
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-gray-50 px-6 py-4 last:border-b-0">
              <div className="h-4 w-40 rounded bg-gray-200" />
              <div className="hidden h-4 w-48 rounded bg-gray-100 md:block" />
              <div className="hidden h-4 w-32 rounded bg-gray-100 lg:block" />
              <div className="ml-auto h-5 w-20 rounded-full bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
