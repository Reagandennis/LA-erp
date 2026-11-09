/**
 * A small, safe rich-text format for free-text fields: bold, italic, bulleted
 * and numbered lists, stored as plain text with Markdown-style markers so the
 * database, search and older entries need nothing new.
 *
 *   **bold**   _italic_   "- item" / "* item"   "1. item"
 *
 * Pure and client-safe: the editor toolbar, the renderer and the server all
 * use these. Nothing here produces HTML, so there is nothing to sanitise.
 */

export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type Block =
  | { type: 'paragraph'; lines: InlineRun[][] }
  | { type: 'list'; ordered: boolean; items: InlineRun[][] };

const BULLET = /^(\s*)[-*]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)\.\s+(.*)$/;

/** Split one line into bold/italic runs. Unmatched markers are kept as text. */
export function parseInline(line: string, bold = false, italic = false): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) runs.push({ text: buffer, bold, italic });
    buffer = '';
  };
  let i = 0;
  while (i < line.length) {
    if (!bold && line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        runs.push(...parseInline(line.slice(i + 2, close), true, italic));
        i = close + 2;
        continue;
      }
    }
    if (!italic && line[i] === '_' && boundaryBefore(line, i)) {
      const close = findItalicClose(line, i + 1);
      if (close > i + 1) {
        flush();
        runs.push(...parseInline(line.slice(i + 1, close), bold, true));
        i = close + 1;
        continue;
      }
    }
    buffer += line[i];
    i++;
  }
  flush();
  return runs;
}

/** An underscore opens italics only at a word start, so snake_case stays as typed. */
function boundaryBefore(line: string, i: number): boolean {
  return i === 0 || /[\s(["'*]/.test(line[i - 1]!);
}

function findItalicClose(line: string, from: number): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === '_' && (j + 1 === line.length || /[\s.,;:!?)\]"'*]/.test(line[j + 1]!)) && line[j - 1] !== ' ') return j;
  }
  return -1;
}

/** Lines into paragraphs and lists. Blank lines separate paragraphs. */
export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: InlineRun[][] = [];
  let list: { ordered: boolean; items: InlineRun[][] } | null = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const closeList = () => {
    if (list) blocks.push({ type: 'list', ...list });
    list = null;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const body = bullet ? bullet[2]! : numbered![3]!;
      closeParagraph();
      if (!list || list.ordered !== ordered) {
        closeList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(body));
      continue;
    }
    closeList();
    if (raw.trim() === '') {
      closeParagraph();
      continue;
    }
    paragraph.push(parseInline(raw));
  }
  closeParagraph();
  closeList();
  return blocks;
}

/** The text with every marker removed, for previews, search and notifications. */
export function plainText(text: string | null | undefined): string {
  if (!text) return '';
  return parseRichText(text)
    .map((block) =>
      block.type === 'paragraph'
        ? block.lines.map(runsText).join('\n')
        : block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '•'} ${runsText(item)}`).join('\n'),
    )
    .join('\n');
}

function runsText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('');
}

// --- Editing -----------------------------------------------------------------

export interface Edit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Wrap the selection in `marker` (or unwrap it when already wrapped). With
 * nothing selected the markers are inserted and the caret left between them.
 */
export function toggleInline(value: string, selectionStart: number, selectionEnd: number, marker: '**' | '_'): Edit {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);
  const m = marker.length;

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= 2 * m) {
    const inner = selected.slice(m, selected.length - m);
    return { value: before + inner + after, selectionStart, selectionEnd: selectionStart + inner.length };
  }
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      value: before.slice(0, -m) + selected + after.slice(m),
      selectionStart: selectionStart - m,
      selectionEnd: selectionEnd - m,
    };
  }
  // Typing inside a pair and pressing the button again: step out past the
  // closing marker rather than opening another pair.
  if (selectionStart === selectionEnd && after.startsWith(marker)) {
    return { value, selectionStart: selectionStart + m, selectionEnd: selectionEnd + m };
  }
  return {
    value: before + marker + selected + marker + after,
    selectionStart: selectionStart + m,
    selectionEnd: selectionEnd + m,
  };
}

/** Where the lines touched by the selection start and end. */
function lineBounds(value: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const nextBreak = value.indexOf('\n', Math.max(selectionEnd, selectionStart));
  const end = nextBreak === -1 ? value.length : nextBreak;
  return { start, end };
}

/**
 * Make the selected lines a bulleted or numbered list — or plain lines again
 * when they already are that kind of list. Switching kinds re-prefixes.
 */
export function toggleList(value: string, selectionStart: number, selectionEnd: number, kind: 'bullet' | 'number'): Edit {
  const { start, end } = lineBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(start, end).split('\n');
  const isKind = (line: string) => (kind === 'bullet' ? BULLET.test(line) : NUMBERED.test(line));
  const allAlready = lines.every((l) => l.trim() === '' || isKind(l));

  const stripped = lines.map((l) => l.replace(BULLET, '$1$2').replace(NUMBERED, '$1$3'));
  // A lone blank line (the caret on an empty line) starts a list; blank lines
  // inside a wider selection are left as separators.
  const single = lines.length === 1;
  const prefix = (l: string, i: number) => (kind === 'bullet' ? `- ${l}` : `${i + 1}. ${l}`);
  const next = allAlready && !(single && lines[0]!.trim() === '')
    ? stripped
    : stripped.map((l, i) => (l.trim() === '' && !single ? l : prefix(l, i)));
  const replaced = next.join('\n');
  // A caret (nothing selected) ends up after the marker, ready to type; a
  // real selection stays selected so the lines can be toggled again.
  const collapsed = selectionStart === selectionEnd;
  return {
    value: value.slice(0, start) + replaced + value.slice(end),
    selectionStart: collapsed ? start + replaced.length : start,
    selectionEnd: start + replaced.length,
  };
}

/**
 * Enter inside a list keeps the list going: the next line gets the next
 * marker. Enter on an empty item ends the list instead. Null when the caret
 * isn't in a list, so the default newline happens.
 */
export function continueList(value: string, caret: number): Edit | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const bullet = BULLET.exec(line);
  const numbered = bullet ? null : NUMBERED.exec(line);
  if (!bullet && !numbered) return null;

  const body = bullet ? bullet[2]! : numbered![3]!;
  const indent = bullet ? bullet[1]! : numbered![1]!;
  if (body.trim() === '') {
    // An empty item: leave the list.
    const next = value.slice(0, lineStart) + indent + value.slice(caret);
    const at = lineStart + indent.length;
    return { value: next, selectionStart: at, selectionEnd: at };
  }
  const marker = bullet ? '- ' : `${Number(numbered![2]) + 1}. `;
  const insert = `\n${indent}${marker}`;
  const next = value.slice(0, caret) + insert + value.slice(caret);
  const at = caret + insert.length;
  return { value: next, selectionStart: at, selectionEnd: at };
}
