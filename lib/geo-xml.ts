/**
 * A minimal XML reader, sized for KML and nothing more.
 *
 * The browser has `DOMParser` and Node does not, so parsing KML on the client
 * would leave the import path untestable under vitest's `node` environment.
 * This is the smallest thing that reads KML correctly on both sides: elements,
 * attributes, text, CDATA, comments, the prolog, and self-closing tags.
 *
 * Namespace prefixes are dropped (`gx:Track` → `Track`) because KML documents in
 * the wild disagree about which prefixes they bind.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Direct text and CDATA content, concatenated in document order. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    attrs[localName(m[1])] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Parse a document and return its root element. Throws on unbalanced markup. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;

  const pushText = (raw: string) => {
    if (!raw) return;
    const node = stack[stack.length - 1];
    node.text += raw;
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      pushText(decodeEntities(source.slice(i)));
      break;
    }
    if (lt > i) pushText(decodeEntities(source.slice(i, lt)));

    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      if (end === -1) throw new Error('Malformed XML: unterminated CDATA section.');
      pushText(source.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      if (end === -1) throw new Error('Malformed XML: unterminated comment.');
      i = end + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt);
      if (end === -1) throw new Error('Malformed XML: unterminated processing instruction.');
      i = end + 2;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      // DOCTYPE and friends — skipped, including a bracketed internal subset.
      let depth = 0;
      let j = lt;
      for (; j < source.length; j += 1) {
        const c = source[j];
        if (c === '[') depth += 1;
        else if (c === ']') depth -= 1;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= source.length) throw new Error('Malformed XML: unterminated declaration.');
      i = j + 1;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) throw new Error('Malformed XML: unterminated tag.');
    const inner = source.slice(lt + 1, gt);

    if (inner[0] === '/') {
      const name = localName(inner.slice(1).trim());
      // Tolerate a stray close tag rather than losing the whole document over it.
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/[\s]/);
    const name = localName((space === -1 ? body : body.slice(0, space)).trim());
    const attrs = space === -1 ? {} : parseAttrs(body.slice(space));

    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  const element = root.children.find((c) => c.name !== '#document');
  if (!element) throw new Error('Malformed XML: no root element.');
  return element;
}

/** First direct child with this name. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** All direct children with this name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Trimmed text of the first direct child with this name, or ''. */
export function textOf(node: XmlNode | undefined, name: string): string {
  return child(node, name)?.text.trim() ?? '';
}

/** Every descendant with this name, depth first. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}
