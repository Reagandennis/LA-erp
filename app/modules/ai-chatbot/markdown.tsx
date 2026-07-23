'use client';

import { Fragment, type ReactNode, useState } from 'react';

/**
 * A deliberately small Markdown renderer covering what the assistant actually
 * emits: headings, fenced code, tables, lists, block quotes, rules, and the
 * inline set (code, bold, italic, links). No dependency, no HTML passthrough —
 * everything is rendered as React nodes, so model output can never inject markup.
 */

// --- Inline ---------------------------------------------------------------

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-i${index}`;
    index += 1;

    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key} className="font-bold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-primary underline underline-offset-2"
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

// --- Code block -----------------------------------------------------------

export function CodeBlock({
  code,
  language,
  title,
}: Readonly<{ code: string; language?: string; title?: string }>) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5">
        <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">
          {title ?? language ?? 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold text-gray-400 transition-colors hover:bg-white hover:text-primary"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-xs leading-relaxed text-gray-800">{code}</code>
      </pre>
    </div>
  );
}

// --- Blocks ---------------------------------------------------------------

type Block =
  | { kind: 'code'; code: string; language?: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'paragraph'; lines: string[] };

function splitRow(line: string) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code. Deliberately lenient: the model sometimes writes trailing
    // text after the language (```ts title=x), and a stricter pattern would
    // leave the line unconsumed by every branch below.
    const fence = /^```\s*(\S+)?/.exec(line.trim());
    if (fence) {
      const language = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: 'code', code: body.join('\n'), language });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    // Table: a pipe row followed by a separator row
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: body });
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].replace(pattern, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      body.push(lines[i]);
      i += 1;
    }

    // Guarantee forward progress: if no branch above claimed this line and the
    // paragraph loop rejected it too, consume it verbatim rather than spinning.
    if (body.length === 0) {
      body.push(lines[i]);
      i += 1;
    }

    blocks.push({ kind: 'paragraph', lines: body });
  }

  return blocks;
}

export function Markdown({
  children,
  compact = false,
}: Readonly<{ children: string; compact?: boolean }>) {
  const blocks = parseBlocks(children);
  const gap = compact ? 'space-y-1.5' : 'space-y-2.5';

  return (
    <div className={`${gap} text-[15px] leading-relaxed text-gray-900`}>
      {blocks.map((block, index) => {
        const key = `b${index}`;

        switch (block.kind) {
          case 'code':
            return <CodeBlock key={key} code={block.code} language={block.language} />;

          case 'heading': {
            const size =
              block.level <= 1
                ? 'text-xl'
                : block.level === 2
                  ? 'text-lg'
                  : 'text-base';
            const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
            return (
              <Tag key={key} className={`${size} font-bold text-primary`}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }

          case 'rule':
            return <hr key={key} className="border-gray-200" />;

          case 'list':
            return block.ordered ? (
              <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-gray-400">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-1 pl-5 marker:text-gray-400">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );

          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-primary/30 pl-3 text-gray-600 italic"
              >
                {renderInline(block.lines.join(' '), key)}
              </blockquote>
            );

          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      {block.header.map((cell, j) => (
                        <th
                          key={`${key}-h${j}`}
                          className="px-2 py-1.5 text-left text-xs font-bold text-gray-500"
                        >
                          {renderInline(cell, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r${r}`} className="border-b border-gray-100">
                        {row.map((cell, c) => (
                          <td key={`${key}-r${r}c${c}`} className="px-2 py-1.5 align-top">
                            {renderInline(cell, `${key}-r${r}c${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return (
              <p key={key}>
                {block.lines.map((line, j) => (
                  <Fragment key={`${key}-l${j}`}>
                    {j > 0 && <br />}
                    {renderInline(line, `${key}-l${j}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

/** Chips rendered above a user bubble for `[Context: …]` module references. */
export function ContextTokens({ names }: Readonly<{ names: string[] }>) {
  if (names.length === 0) return null;

  return (
    <div className="mb-1 flex flex-wrap justify-end gap-1">
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary"
        >
          {name}
        </span>
      ))}
    </div>
  );
}
