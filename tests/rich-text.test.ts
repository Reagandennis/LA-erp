import { describe, expect, it } from 'vitest';

import { continueList, parseInline, parseRichText, plainText, toggleInline, toggleList } from '../lib/rich-text';

describe('parseInline', () => {
  it('reads bold, italic and both', () => {
    expect(parseInline('All **quiet** at the _gate_')).toEqual([
      { text: 'All ', bold: false, italic: false },
      { text: 'quiet', bold: true, italic: false },
      { text: ' at the ', bold: false, italic: false },
      { text: 'gate', bold: false, italic: true },
    ]);
    expect(parseInline('**_both_**')).toEqual([{ text: 'both', bold: true, italic: true }]);
  });

  it('leaves unmatched markers and snake_case alone', () => {
    expect(parseInline('2 ** 3 and gate_pass_1')).toEqual([{ text: '2 ** 3 and gate_pass_1', bold: false, italic: false }]);
    expect(parseInline('a_b_c')).toEqual([{ text: 'a_b_c', bold: false, italic: false }]);
  });
});

describe('parseRichText', () => {
  it('groups lines into paragraphs and lists', () => {
    const blocks = parseRichText('Summary line one\nline two\n\n- first\n- **second**\n\n1. step\n2. step\nTrailing text');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ text: 'Summary line one', bold: false, italic: false }], [{ text: 'line two', bold: false, italic: false }]] },
      { type: 'list', ordered: false, items: [[{ text: 'first', bold: false, italic: false }], [{ text: 'second', bold: true, italic: false }]] },
      { type: 'list', ordered: true, items: [[{ text: 'step', bold: false, italic: false }], [{ text: 'step', bold: false, italic: false }]] },
      { type: 'paragraph', lines: [[{ text: 'Trailing text', bold: false, italic: false }]] },
    ]);
  });

  it('renders an old plain entry as one paragraph', () => {
    expect(parseRichText('All normal.')).toEqual([{ type: 'paragraph', lines: [[{ text: 'All normal.', bold: false, italic: false }]] }]);
    expect(parseRichText('')).toEqual([]);
  });
});

describe('plainText', () => {
  it('drops the markers and numbers the lists', () => {
    expect(plainText('**Gate 2** closed\n- torch _missing_\n1. call ops\n2. log it')).toBe('Gate 2 closed\n• torch missing\n1. call ops\n2. log it');
    expect(plainText(null)).toBe('');
  });
});

describe('toggleInline', () => {
  it('wraps a selection, and unwraps it again', () => {
    const on = toggleInline('all quiet here', 4, 9, '**');
    expect(on).toEqual({ value: 'all **quiet** here', selectionStart: 6, selectionEnd: 11 });
    const off = toggleInline(on.value, on.selectionStart, on.selectionEnd, '**');
    expect(off).toEqual({ value: 'all quiet here', selectionStart: 4, selectionEnd: 9 });
  });

  it('unwraps when the markers themselves are selected', () => {
    expect(toggleInline('a **b** c', 2, 7, '**')).toEqual({ value: 'a b c', selectionStart: 2, selectionEnd: 3 });
  });

  it('inserts an empty pair and parks the caret between them', () => {
    expect(toggleInline('note ', 5, 5, '_')).toEqual({ value: 'note __', selectionStart: 6, selectionEnd: 6 });
  });
});

describe('toggleList', () => {
  it('prefixes every selected line, numbering in order', () => {
    const value = 'intro\ncall ops\ncheck gate\nlog it';
    const start = value.indexOf('call');
    const end = value.indexOf('log') + 3;
    expect(toggleList(value, start, end, 'number').value).toBe('intro\n1. call ops\n2. check gate\n3. log it');
    expect(toggleList(value, start, end, 'bullet').value).toBe('intro\n- call ops\n- check gate\n- log it');
  });

  it('removes the list when every line already has it, and switches kinds otherwise', () => {
    expect(toggleList('- a\n- b', 0, 7, 'bullet').value).toBe('a\nb');
    expect(toggleList('- a\n- b', 0, 7, 'number').value).toBe('1. a\n2. b');
  });

  it('works on the caret’s line alone with nothing selected', () => {
    expect(toggleList('first\nsecond', 8, 8, 'bullet')).toEqual({ value: 'first\n- second', selectionStart: 14, selectionEnd: 14 });
  });
});

describe('continueList', () => {
  it('starts the next item on Enter, counting up for numbers', () => {
    expect(continueList('- torch', 7)).toEqual({ value: '- torch\n- ', selectionStart: 10, selectionEnd: 10 });
    expect(continueList('1. call\n2. log', 14)).toEqual({ value: '1. call\n2. log\n3. ', selectionStart: 18, selectionEnd: 18 });
  });

  it('ends the list on an empty item, and does nothing outside a list', () => {
    expect(continueList('- a\n- ', 6)).toEqual({ value: '- a\n', selectionStart: 4, selectionEnd: 4 });
    expect(continueList('plain line', 10)).toBeNull();
  });
});

describe('toolbar edge cases', () => {
  it('steps out of a pair when the button is pressed again after typing inside it', () => {
    expect(toggleInline('All **quiet** here', 11, 11, '**')).toEqual({ value: 'All **quiet** here', selectionStart: 13, selectionEnd: 13 });
  });

  it('starts a list on an empty line', () => {
    expect(toggleList('intro\n', 6, 6, 'bullet')).toEqual({ value: 'intro\n- ', selectionStart: 8, selectionEnd: 8 });
    expect(toggleList('', 0, 0, 'number')).toEqual({ value: '1. ', selectionStart: 3, selectionEnd: 3 });
  });
});
