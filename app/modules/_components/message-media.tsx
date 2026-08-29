'use client';

import { useState } from 'react';

/**
 * Renders one message attachment, shared by the Telegram/Signal console and the
 * WhatsApp client. Bytes are never inlined into the thread JSON — this points at
 * `GET /api/<service>/media`, which streams them behind the same permission gate.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface MessageMedia {
  kind: MediaKind;
  /** Opaque provider token; empty for outbound media we can't fetch back. */
  ref: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
}

export function mediaUrl(service: string, chatId: string, ref: string): string {
  return `/api/${service}/media?chatId=${encodeURIComponent(chatId)}&ref=${encodeURIComponent(ref)}`;
}

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileChip({ media, out, href }: { media: MessageMedia; out: boolean; href: string | null }) {
  const size = humanSize(media.sizeBytes);
  const body = (
    <span className="flex items-center gap-2">
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m0 0H5.625"
        />
      </svg>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{media.fileName ?? 'Attachment'}</span>
        {size && <span className={`block text-[11px] ${out ? 'text-white/70' : 'text-gray-500'}`}>{size}</span>}
      </span>
    </span>
  );

  const shell = `flex max-w-full items-center rounded-lg px-2.5 py-2 ${out ? 'bg-white/15' : 'bg-gray-100'}`;
  // Without a ref there is nothing to fetch (outbound media we just sent), so
  // the chip stays inert rather than offering a link that would 404.
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${shell} transition hover:opacity-80`}>
      {body}
    </a>
  ) : (
    <span className={shell}>{body}</span>
  );
}

export default function MessageMediaView({
  service,
  chatId,
  media,
  out,
}: {
  service: string;
  chatId: string;
  media: MessageMedia;
  out: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const href = media.ref ? mediaUrl(service, chatId, media.ref) : null;

  if (!href || failed) return <FileChip media={media} out={out} href={href} />;

  if (media.kind === 'image' || media.kind === 'sticker') {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- provider-streamed
            bytes behind an auth-gated API route; next/image cannot optimise these. */}
        <img
          src={href}
          alt={media.fileName ?? 'Attachment'}
          onError={() => setFailed(true)}
          className={`max-h-72 w-auto max-w-full rounded-lg object-cover ${
            media.kind === 'sticker' ? 'bg-transparent' : ''
          }`}
        />
      </a>
    );
  }

  if (media.kind === 'video') {
    return (
      <video
        src={href}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-72 w-auto max-w-full rounded-lg"
      />
    );
  }

  if (media.kind === 'audio') {
    return <audio src={href} controls preload="metadata" onError={() => setFailed(true)} className="max-w-full" />;
  }

  return <FileChip media={media} out={out} href={href} />;
}
