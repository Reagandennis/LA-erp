'use client';

/** The footer under a windowed list: how many rows are still unrendered, and a way to get them. */
export default function ShowMoreButton({
  hiddenCount,
  onShowMore,
  onShowAll,
  noun = 'rows',
}: {
  hiddenCount: number;
  onShowMore: () => void;
  onShowAll?: () => void;
  noun?: string;
}) {
  if (hiddenCount <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
      <button
        type="button"
        onClick={onShowMore}
        className="rounded-xl border border-gray-200 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:border-primary/40 hover:text-primary"
      >
        Show more
      </button>
      <span className="text-gray-400">
        {hiddenCount.toLocaleString()} more {noun}
      </span>
      {onShowAll && (
        <button type="button" onClick={onShowAll} className="font-medium text-primary hover:underline">
          Show all
        </button>
      )}
    </div>
  );
}
