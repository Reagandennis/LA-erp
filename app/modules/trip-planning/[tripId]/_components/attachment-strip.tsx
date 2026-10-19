'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatBytes } from '@/lib/attachment-types';

import type { TripItemAttachmentSummary } from '../../types';

/** Thumbnails shown on a card before the rest fold into "+N". */
const MAX_THUMBS = 6;

const BADGE_STYLES: Array<{ test: RegExp; label: string; className: string }> = [
  { test: /pdf/, label: 'PDF', className: 'bg-rose-100 text-rose-700' },
  { test: /word|msword/, label: 'DOC', className: 'bg-blue-100 text-blue-700' },
  { test: /sheet|excel|csv/, label: 'XLS', className: 'bg-emerald-100 text-emerald-700' },
  { test: /presentation|powerpoint/, label: 'PPT', className: 'bg-orange-100 text-orange-700' },
  { test: /heic|heif|image/, label: 'IMG', className: 'bg-violet-100 text-violet-700' },
  { test: /text/, label: 'TXT', className: 'bg-slate-200 text-slate-700' },
];

export function FileBadge({ mimeType }: { mimeType: string }) {
  const style = BADGE_STYLES.find((s) => s.test.test(mimeType)) ?? {
    label: 'FILE',
    className: 'bg-slate-200 text-slate-600',
  };
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[9px] font-black tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/** Photos as thumbnails that open full size; documents as tiles that open the file. */
export function AttachmentStrip({ attachments }: { attachments: TripItemAttachmentSummary[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.thumbnailUrl);
  const documents = attachments.filter((a) => !a.thumbnailUrl);
  const shown = images.slice(0, MAX_THUMBS);
  const hidden = images.length - shown.length;

  return (
    <div className="mt-3 space-y-2 border-t border-dashed border-slate-200 pt-3">
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shown.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setViewing(index)}
              aria-label={`View ${image.filename}`}
              className="relative h-16 w-16 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 transition hover:ring-2 hover:ring-primary sm:h-20 sm:w-20"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.thumbnailUrl!} alt="" loading="lazy" className="h-full w-full object-cover" />
              {hidden > 0 && index === shown.length - 1 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                  +{hidden}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {documents.map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex max-w-[15rem] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-3 transition hover:border-primary/40 hover:bg-white"
            >
              <FileBadge mimeType={doc.mimeType} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-700">{doc.filename}</span>
                <span className="block text-[10px] text-slate-400">{formatBytes(doc.size)}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      {viewing !== null && images[viewing] && (
        <Lightbox images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: TripItemAttachmentSummary[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const count = images.length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex((index + 1) % count);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onIndex, onClose]);

  const arrow = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20';

  return createPortal(
    // A portal still bubbles React events to the card, whose pointer-down starts a drag.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.filename}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClose}
      className="fixed inset-0 z-[400] flex flex-col bg-black/85 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">{image.filename}</span>
        {count > 1 && (
          <span className="shrink-0 tabular-nums">
            {index + 1} / {count}
          </span>
        )}
        <a
          href={`${image.url}?download=1`}
          className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/20"
        >
          Download
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg p-1.5 text-white hover:bg-white/10"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={image.id}
          src={image.url}
          alt={image.filename}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => {
                e.stopPropagation();
                onIndex((index - 1 + count) % count);
              }}
              className={`${arrow} left-4`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                onIndex((index + 1) % count);
              }}
              className={`${arrow} right-4`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
