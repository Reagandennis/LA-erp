import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../app/modules/ai-chatbot/markdown';
import { describeAction, OutcomeLine } from '../app/modules/ai-chatbot/tool-calls';

const md = (text: string) => renderToStaticMarkup(createElement(Markdown, null, text));

describe('the reply as Markdown', () => {
  it('leaves underscores inside a word alone', () => {
    const html = md('Call update_trip_status and save_trip_event next.');
    expect(html).not.toContain('<em');
    expect(html).toContain('update_trip_status');
  });

  it('still italicises and emboldens text that is marked', () => {
    expect(md('this is _important_ and **urgent**')).toMatch(/<em[^>]*>important<\/em>.*<strong[^>]*>urgent<\/strong>/);
    expect(md('a * b * c')).not.toContain('<em');
  });

  it('renders a link inside bold text', () => {
    expect(md('**[BRG-ZAF-NOV-2668](/modules/trip-planning/1589)**')).toMatch(
      /<strong[^>]*><a href="\/modules\/trip-planning\/1589"[^>]*>BRG-ZAF-NOV-2668<\/a><\/strong>/,
    );
  });

  it('links into the app and to the web, and nowhere else', () => {
    expect(md('[trip](/modules/trip-planning/1)')).toContain('href="/modules/trip-planning/1"');
    expect(md('[site](https://example.com/a)')).toContain('href="https://example.com/a"');
    for (const bad of ['javascript:alert(1)', '//evil.example/x', 'data:text/html,x']) {
      const html = md(`[click](${bad})`);
      expect(html).not.toContain('<a ');
      expect(html).toContain('click');
    }
  });

  it('renders a table that sits straight under a line of text', () => {
    const html = md('Here are the trips:\n| Ref | Status |\n|---|---|\n| BRG-1 | Active |');
    expect(html).toContain('<table');
    expect(html).toContain('<td');
    expect(html).toContain('Here are the trips:');
  });

  it('does not read a dashed line under "a | b" as a table', () => {
    expect(md('yes | no\n---\nafter')).not.toContain('<table');
  });
});

describe('what the reply did, under the reply', () => {
  const line = (props: Parameters<typeof OutcomeLine>[0]) => renderToStaticMarkup(createElement(OutcomeLine, props));

  it('says "No changes made" over a reply that changed nothing, whatever the reply claims', () => {
    expect(line({ outcome: { changed: 0, failed: 0 }, actions: [] })).toContain('No changes made.');
    const readOnly = line({ outcome: { changed: 0, failed: 0 }, actions: [{ tool: 'find_trips', kind: 'read', ok: true, result: { total: 3 } }] });
    expect(readOnly).toContain('No changes made.');
  });

  it('lists each change with a link to the record', () => {
    const html = line({
      outcome: { changed: 1, failed: 0 },
      actions: [
        { tool: 'get_trip', kind: 'read', ok: true, result: {} },
        {
          tool: 'save_trip_event',
          kind: 'write',
          ok: true,
          result: { eventId: 9 },
          summary: 'Added "Airport pickup" to BRG-ZAF-NOV-2668 on 2026-11-25 09:00',
          href: '/modules/trip-planning/1589',
        },
      ],
    });
    expect(html).toContain('1 change made');
    expect(html).toContain('Added &quot;Airport pickup&quot; to BRG-ZAF-NOV-2668');
    expect(html).toContain('href="/modules/trip-planning/1589"');
  });

  it('shows a failed step, and its reason, in the open', () => {
    const html = line({
      outcome: { changed: 0, failed: 1 },
      actions: [{ tool: 'update_trip', kind: 'write', ok: false, result: { error: 'Cannot edit a trip in status "Cancelled"' } }],
    });
    expect(html).toContain('1 step failed and was not done');
    expect(html).toContain('Cannot edit a trip in status');
    expect(html).toContain('Nothing was changed.');
  });

  it('says it is waiting while an action is held for Confirm', () => {
    expect(line({ outcome: { changed: 0, failed: 0 }, actions: [], waiting: true })).toContain('Waiting for you to confirm');
  });

  it('only links into this app', () => {
    expect(describeAction({ tool: 'x', result: {}, href: 'https://evil.example' }, 0).href).toBeNull();
    expect(describeAction({ tool: 'x', result: {}, href: '//evil.example' }, 0).href).toBeNull();
    expect(describeAction({ tool: 'x', result: {}, href: '/modules/quotes/3/edit' }, 0).href).toBe('/modules/quotes/3/edit');
  });

  it('reads a tool result as failed from the server flag or from its error', () => {
    expect(describeAction({ tool: 'delete_customer', result: { error: 'no' } }, 0)).toMatchObject({ ok: false, name: 'delete client', detail: 'no' });
    expect(describeAction({ tool: 'x', result: {}, ok: false }, 0).ok).toBe(false);
  });
});
