import 'server-only';

import type { MessagingProvider } from './messaging-accounts';

/**
 * Turn something a person typed into a chat id the provider will accept.
 *
 * Each provider addresses conversations differently, and getting this wrong
 * means a silently undelivered message, so the rules live in one place:
 *
 *   WhatsApp  digits only, then `@s.whatsapp.net` (wacli also accepts a bare
 *             number, but the JID is what the mirror keys on)
 *   Signal    E.164, leading `+` required
 *   Telegram  a numeric peer id, or an @username we resolve at send time
 */

export interface ResolvedTarget {
  chatId: string;
  /** Display name to show until the provider tells us the real one. */
  name: string;
}

export function resolveNewChatTarget(
  provider: MessagingProvider,
  raw: string,
): ResolvedTarget | { error: string } {
  const input = raw.trim();
  if (!input) return { error: 'Enter a phone number or username.' };

  if (provider === 'whatsapp') {
    const digits = input.replace(/[^\d]/g, '');
    if (digits.length < 7 || digits.length > 15) {
      return { error: 'Enter a full phone number with country code, e.g. +254712345678.' };
    }
    return { chatId: `${digits}@s.whatsapp.net`, name: `+${digits}` };
  }

  if (provider === 'signal') {
    const e164 = input.startsWith('+') ? input : `+${input.replace(/[^\d]/g, '')}`;
    if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
      return { error: 'Signal needs a full number with country code, e.g. +254712345678.' };
    }
    return { chatId: e164, name: e164 };
  }

  // Telegram: a username (resolved server-side) or a raw peer id.
  if (input.startsWith('@')) {
    const username = input.slice(1);
    if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) {
      return { error: 'That does not look like a Telegram username.' };
    }
    return { chatId: `@${username}`, name: input };
  }
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+?\d{5,}$/.test(digits)) {
    return { chatId: digits.replace('+', ''), name: input };
  }
  return { error: 'Enter a @username, or pick an existing chat.' };
}
