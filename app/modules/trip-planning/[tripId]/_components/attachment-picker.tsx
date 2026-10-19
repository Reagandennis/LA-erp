'use client';

import { useCallback, useState } from 'react';

import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_ITEM,
  formatBytes,
  isPreviewableImage,
  resolveAttachmentType,
} from '@/lib/attachment-types';

import type { TripItemAttachmentSummary } from '../../types';
import { FileBadge } from './attachment-strip';

/** A picked file's own preview, released when the tile goes away. */
function LocalThumb({ file }: { file: File }) {
  const attach = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={attach} alt="" className="h-full w-full object-cover" />;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-rose-600"
    >
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/** Photos and documents for an event: the saved ones, plus files waiting to upload. */
export function AttachmentPicker({
  attachments,
  removedIds,
  newFiles,
  onChange,
}: {
  attachments: TripItemAttachmentSummary[];
  removedIds: number[];
  newFiles: File[];
  onChange: (next: { removedAttachmentIds: number[]; newFiles: File[] }) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const kept = attachments.filter((a) => !removedIds.includes(a.id));
  const room = MAX_ATTACHMENTS_PER_ITEM - kept.length - newFiles.length;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const accepted = picked.filter((file) => resolveAttachmentType(file) !== null);
    const rejected = picked.length - accepted.length;
    const fitting = accepted.slice(0, Math.max(0, room));
    const dropped = accepted.length - fitting.length;
    setNotice(
      [
        rejected > 0 ? `${rejected} file${rejected === 1 ? '' : 's'} skipped: only photos and documents (PDF, Word, Excel, PowerPoint, text) can be added.` : null,
        dropped > 0 ? `An event holds at most ${MAX_ATTACHMENTS_PER_ITEM} files.` : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
    );
    if (fitting.length > 0) onChange({ removedAttachmentIds: removedIds, newFiles: [...newFiles, ...fitting] });
  };

  const tile = 'relative h-20 w-20 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200';

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Photos &amp; documents</p>

      {(kept.length > 0 || newFiles.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {kept.map((attachment) =>
            attachment.thumbnailUrl ? (
              <div key={attachment.id} className={tile} title={attachment.filename}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                <RemoveButton
                  label={`Remove ${attachment.filename}`}
                  onClick={() => onChange({ removedAttachmentIds: [...removedIds, attachment.id], newFiles })}
                />
              </div>
            ) : (
              <div key={attachment.id} className={`${tile} flex flex-col items-center justify-center gap-1 bg-white px-1`} title={attachment.filename}>
                <FileBadge mimeType={attachment.mimeType} />
                <span className="w-full truncate text-center text-[10px] text-slate-500">{attachment.filename}</span>
                <RemoveButton
                  label={`Remove ${attachment.filename}`}
                  onClick={() => onChange({ removedAttachmentIds: [...removedIds, attachment.id], newFiles })}
                />
              </div>
            ),
          )}
          {newFiles.map((file, index) => {
            const type = resolveAttachmentType(file) ?? '';
            return (
              <div
                key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                className={`${tile} ${isPreviewableImage(type) ? '' : 'flex flex-col items-center justify-center gap-1 bg-white px-1'} ring-primary/40`}
                title={`${file.name} · ${formatBytes(file.size)} · uploads when you save`}
              >
                {isPreviewableImage(type) ? (
                  <LocalThumb file={file} />
                ) : (
                  <>
                    <FileBadge mimeType={type} />
                    <span className="w-full truncate text-center text-[10px] text-slate-500">{file.name}</span>
                  </>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[9px] font-bold uppercase text-white">New</span>
                <RemoveButton
                  label={`Remove ${file.name}`}
                  onClick={() =>
                    onChange({ removedAttachmentIds: removedIds, newFiles: newFiles.filter((_, i) => i !== index) })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {removedIds.length > 0 && (
        <p className="mb-2 text-xs text-gray-500">
          {removedIds.length} file{removedIds.length === 1 ? '' : 's'} will be removed when you save.{' '}
          <button
            type="button"
            onClick={() => onChange({ removedAttachmentIds: [], newFiles })}
            className="font-medium text-primary hover:underline"
          >
            Undo
          </button>
        </p>
      )}

      {room > 0 ? (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            addFiles(event.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center transition ${
            dragOver ? 'border-primary bg-primary/5' : 'border-gray-200 bg-white hover:border-primary/40'
          }`}
        >
          <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Add photos or documents</span>
          <span className="text-xs text-gray-400">Drop files here or click to choose · PDF, Word, Excel, images</span>
          <input
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              // Let the same file be picked again after it's removed.
              event.target.value = '';
            }}
          />
        </label>
      ) : (
        <p className="text-xs text-gray-500">This event has the maximum of {MAX_ATTACHMENTS_PER_ITEM} files.</p>
      )}
      {notice && <p className="mt-2 text-xs text-amber-700">{notice}</p>}
    </div>
  );
}
