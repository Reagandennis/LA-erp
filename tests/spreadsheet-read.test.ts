import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { SpreadsheetError, excelSerialToDate, readSpreadsheet } from '../lib/spreadsheet-read';

/** A zip archive of text files, enough to stand in for an .xlsx. */
function zip(files: Record<string, string>, method: 'deflate' | 'store' = 'deflate'): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 'deflate' ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method === 'deflate' ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method === 'deflate' ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Notes" sheetId="1" state="hidden" r:id="rId1"/>
    <sheet name="Nov &amp; Dec" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/>
</Relationships>`;

const STRINGS = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Name</t></si>
  <si><r><t>Mercy </t></r><r><rPr><b/></rPr><t>Wanjiru</t></r><rPh><t>ignored</t></rPh></si>
  <si/>
  <si><t xml:space="preserve">O&apos;Brien &amp; Co_x000D_</t></si>
</sst>`;

const STYLES = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="d\\-mmm"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;days&quot;"/></numFmts>
  <cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>
</styleSheet>`;

const SHEET = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols><col min="1" max="1" width="20"/></cols>
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46327</v></c><c r="C1" s="2"><v>46328.5</v></c><c r="E1" s="3"><v>3</v></c></row>
    <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="inlineStr"><is><t>D</t></is></c><c r="C3" t="str"><f>UPPER("n")</f><v>N</v></c><c r="D3"/><c r="E3" t="s"><v>3</v></c><c r="F3"><v>8.0000000000000018</v></c><c r="G3" t="b"><v>1</v></c><c r="H3" t="e"><v>#N/A</v></c></row>
  </sheetData>
</worksheet>`;

const xlsx = (extra: Record<string, string> = {}) =>
  zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/sharedStrings.xml': STRINGS,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>hidden</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': SHEET,
    ...extra,
  });

describe('reading an .xlsx', () => {
  it('reads every sheet with its name and whether it is hidden', () => {
    const sheets = readSpreadsheet('roster.xlsx', xlsx());
    expect(sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Notes', true],
      ['Nov & Dec', false],
    ]);
    expect(sheets[0]?.rows).toEqual([['hidden']]);
  });

  it('turns cells into text: shared and inline strings, formulas, numbers, and dates by their format', () => {
    const rows = readSpreadsheet('roster.xlsx', xlsx())[1]?.rows;
    expect(rows).toEqual([
      // A date by a built-in format, a date-time by a custom one, and a number whose format only looks wordy.
      ['Name', '2026-11-01', '2026-11-02', '', '3'],
      [],
      ['Mercy Wanjiru', 'D', 'N', '', "O'Brien & Co", '8', 'TRUE'],
    ]);
  });

  it('reads an archive stored without compression, and one named with another extension', () => {
    expect(readSpreadsheet('roster.csv', zip({ 'xl/workbook.xml': WORKBOOK, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet2.xml': SHEET }, 'store'))).toHaveLength(1);
  });

  it('counts dates from 1904 when the workbook says so', () => {
    expect(excelSerialToDate(46327)).toBe('2026-11-01');
    expect(excelSerialToDate(61)).toBe('1900-03-01');
    expect(excelSerialToDate(44865, true)).toBe('2026-11-01');
    expect(excelSerialToDate(0)).toBeNull();
    const sheets = readSpreadsheet('r.xlsx', xlsx({ 'xl/workbook.xml': WORKBOOK.replace('<sheets>', '<workbookPr date1904="1"/><sheets>') }));
    expect(sheets[1]?.rows[0]?.[1]).toBe('2030-11-02');
  });

  it('explains a file it cannot read', () => {
    expect(() => readSpreadsheet('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).toThrow(/older Excel file/);
    expect(() => readSpreadsheet('x.xlsx', zip({ 'word/document.xml': '<w/>' }))).toThrow(/not an Excel workbook/);
    expect(() => readSpreadsheet('x.xlsx', Buffer.from('PK\u0003\u0004 not really a zip'))).toThrow(SpreadsheetError);
    expect(() => readSpreadsheet('x.csv', Buffer.alloc(0))).toThrow(/empty/);
    expect(() => readSpreadsheet('x.csv', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toThrow(/not a spreadsheet/);
  });

  it('refuses a part that inflates out of all proportion', () => {
    const bomb = zip({ 'xl/workbook.xml': WORKBOOK, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet2.xml': 'x'.repeat(30 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => readSpreadsheet('bomb.xlsx', bomb)).toThrow(SpreadsheetError);
  });
});

describe('reading delimited text', () => {
  it('reads a CSV with quoted cells and a byte-order mark', () => {
    const rows = readSpreadsheet('nov.csv', Buffer.from('﻿Code,Name,1,2\r\nTRC-1,"Enoch, Reagan",D , N\r\n\r\n'))[0];
    expect(rows?.name).toBe('nov');
    expect(rows?.rows).toEqual([
      ['Code', 'Name', '1', '2'],
      ['TRC-1', 'Enoch, Reagan', 'D', 'N'],
    ]);
  });

  it('finds the separator past a title line', () => {
    const text = 'NOVEMBER ROSTER\nName;1;2;3\nMercy;D;D;N\n';
    expect(readSpreadsheet('r.csv', Buffer.from(text))[0]?.rows[2]).toEqual(['Mercy', 'D', 'D', 'N']);
    expect(readSpreadsheet('r.txt', Buffer.from('Name\t1\t2\nMercy\tD\tN\n'))[0]?.rows[1]).toEqual(['Mercy', 'D', 'N']);
  });

  it("reads Excel's Unicode Text and its Windows CSV", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\t1\nZoë\tD\n', 'utf16le')]);
    expect(readSpreadsheet('r.txt', utf16)[0]?.rows[1]).toEqual(['Zoë', 'D']);
    const windows = Buffer.concat([Buffer.from('Name,1\nZo'), Buffer.from([0xeb]), Buffer.from(',D\n')]);
    expect(readSpreadsheet('r.csv', windows)[0]?.rows[1]).toEqual(['Zoë', 'D']);
  });
});
