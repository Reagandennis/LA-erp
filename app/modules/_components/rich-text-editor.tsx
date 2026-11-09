'use client';

import { useEffect, useRef, useState } from 'react';

import { continueList, type Edit, toggleInline, toggleList } from '@/lib/rich-text';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Styles for the text area itself; the toolbar sits above it. */
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  /** Tighter toolbar for small forms such as the ops dashboard's. */
  compact?: boolean;
}

/**
 * A text area with Bold, Italic, bulleted and numbered list buttons. The
 * text stays plain, with Markdown-style markers (lib/rich-text.ts), so it is
 * stored, searched and read back exactly as typed. Ctrl/Cmd+B and Ctrl/Cmd+I
 * work too, and Enter inside a list starts the next item.
 */
export default function RichTextEditor({
  value,
  onChange,
  rows = 3,
  placeholder,
  className = '',
  autoFocus,
  'aria-label': ariaLabel,
  compact = false,
}: RichTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Where the caret should land once the edited value has rendered. */
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!pendingSelection || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(pendingSelection.start, pendingSelection.end);
    setPendingSelection(null);
  }, [pendingSelection]);

  const apply = (edit: Edit) => {
    onChange(edit.value);
    setPendingSelection({ start: edit.selectionStart, end: edit.selectionEnd });
  };
  const selection = () => {
    const el = ref.current;
    return el ? { start: el.selectionStart, end: el.selectionEnd } : { start: value.length, end: value.length };
  };
  const bold = () => {
    const { start, end } = selection();
    apply(toggleInline(value, start, end, '**'));
  };
  const italic = () => {
    const { start, end } = selection();
    apply(toggleInline(value, start, end, '_'));
  };
  const list = (kind: 'bullet' | 'number') => {
    const { start, end } = selection();
    apply(toggleList(value, start, end, kind));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      bold();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      italic();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.nativeEvent.isComposing) {
      const el = e.currentTarget;
      if (el.selectionStart !== el.selectionEnd) return;
      const next = continueList(value, el.selectionStart);
      if (next) {
        e.preventDefault();
        apply(next);
      }
    }
  };

  const buttonClass = `inline-flex items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-200/70 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
    compact ? 'h-6 w-6' : 'h-7 w-7'
  }`;
  const iconClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div className="rounded-xl ring-1 ring-transparent focus-within:ring-primary/30">
      <div
        role="toolbar"
        aria-label="Text formatting"
        className={`flex items-center gap-0.5 rounded-t-xl border border-b-0 border-gray-200 bg-gray-100/80 ${compact ? 'px-1 py-0.5' : 'px-1.5 py-1'}`}
      >
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={bold} title="Bold (Ctrl+B)" aria-label="Bold" className={buttonClass}>
          <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4h6.5a4.5 4.5 0 013.2 7.7A4.75 4.75 0 0114.25 20H7V4zm3 6.5h3.4a1.75 1.75 0 000-3.5H10v3.5zm0 3v3.5h4.2a1.75 1.75 0 000-3.5H10z" />
          </svg>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={italic} title="Italic (Ctrl+I)" aria-label="Italic" className={buttonClass}>
          <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M10 4h8v2.5h-2.8l-3.4 11H15V20H7v-2.5h2.8l3.4-11H10V4z" />
          </svg>
        </button>
        <span className="mx-1 h-4 w-px bg-gray-300" aria-hidden="true" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => list('bullet')} title="Bulleted list" aria-label="Bulleted list" className={buttonClass}>
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => list('number')} title="Numbered list" aria-label="Numbered list" className={buttonClass}>
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M10 6h10M10 12h10M10 18h10" />
            <path d="M4 5.5l1.5-1V9M3.8 12.2c.5-1 2.4-1 2.4.3 0 .9-2.5 1.8-2.5 3h2.6M3.8 17h1.6a1 1 0 010 2H4.6m.8 0a1 1 0 010 2H3.8" strokeWidth={1.5} />
          </svg>
        </button>
      </div>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={`${className} rounded-t-none border border-gray-200 focus:ring-0`}
      />
    </div>
  );
}
