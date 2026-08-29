import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveNewChatTarget } from '../lib/messaging-new-chat';

/**
 * Getting an address wrong means a message that silently never arrives, so each
 * provider's accepted forms are pinned down here.
 */
describe('resolveNewChatTarget', () => {
  it('turns a WhatsApp number into a JID, however it was typed', () => {
    for (const input of ['+254712345678', '254712345678', '+254 712 345 678', '(254) 712-345678']) {
      expect(resolveNewChatTarget('whatsapp', input)).toEqual({
        chatId: '254712345678@s.whatsapp.net',
        name: '+254712345678',
      });
    }
  });

  it('requires a full WhatsApp number', () => {
    expect(resolveNewChatTarget('whatsapp', '12345')).toHaveProperty('error');
    expect(resolveNewChatTarget('whatsapp', '')).toHaveProperty('error');
  });

  it('normalises Signal to E.164 and insists on a country code', () => {
    expect(resolveNewChatTarget('signal', '254712345678')).toEqual({
      chatId: '+254712345678',
      name: '+254712345678',
    });
    expect(resolveNewChatTarget('signal', '+254712345678')).toEqual({
      chatId: '+254712345678',
      name: '+254712345678',
    });
    expect(resolveNewChatTarget('signal', '0712345678')).toHaveProperty('error');
  });

  it('accepts a Telegram @username', () => {
    expect(resolveNewChatTarget('telegram', '@ada_lovelace')).toEqual({
      chatId: '@ada_lovelace',
      name: '@ada_lovelace',
    });
  });

  it('rejects a malformed Telegram username', () => {
    expect(resolveNewChatTarget('telegram', '@ab')).toHaveProperty('error');
    expect(resolveNewChatTarget('telegram', '@has spaces')).toHaveProperty('error');
    expect(resolveNewChatTarget('telegram', 'not-a-handle')).toHaveProperty('error');
  });

  it('accepts a raw Telegram peer id', () => {
    expect(resolveNewChatTarget('telegram', '7395438063')).toEqual({
      chatId: '7395438063',
      name: '7395438063',
    });
  });

  it('rejects empty input for every provider', () => {
    for (const p of ['whatsapp', 'telegram', 'signal'] as const) {
      expect(resolveNewChatTarget(p, '   ')).toHaveProperty('error');
    }
  });
});
