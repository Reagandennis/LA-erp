/**
 * Where the assistant's chats are kept in the browser. They hold business
 * data (tool results included), so each signed-in person has their own, and
 * signing out removes them: a shared computer must not hand one person's
 * chats to the next.
 */

const PREFIX = 'la-erp.jarvis.';

export const chatsKey = (userId: number) => `${PREFIX}${userId}.chats`;
export const activeChatKey = (userId: number) => `${PREFIX}${userId}.active`;

/** A layout preference, not data: it stays. */
export const INSPECTOR_WIDTH_KEY = `${PREFIX}inspector-width`;

/** The keys every account on a browser once shared. */
const LEGACY_KEYS = [`${PREFIX}chats`, `${PREFIX}active`];

/** Drops the chats saved before they were kept per person. */
export function removeLegacyChats(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}

/** Removes every saved chat on this browser. Called when someone signs out. */
export function clearSavedChats(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX) && key !== INSPECTOR_WIDTH_KEY) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}
