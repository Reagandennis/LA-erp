import type { GeminiContent } from './gemini';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_HISTORY_TURNS = 8;
/**
 * Everything in a request is sent again on every tool round (up to six calls
 * per message), so text is capped: a pasted document would otherwise be paid
 * for six times over.
 */
export const MAX_PROMPT_CHARS = 4000;
const MAX_TURN_CHARS = 1500;
const MAX_HISTORY_CHARS = 9000;

/** The recent conversation, each turn shortened and the oldest dropped to fit the cap. */
export function trimHistory(history: unknown): GeminiContent[] {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter((t): t is ChatTurn => !!t && typeof t === 'object' && typeof (t as ChatTurn).text === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, text: t.text.length > MAX_TURN_CHARS ? `${t.text.slice(0, MAX_TURN_CHARS)}…` : t.text }));
  let total = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (turns.length > 0 && total > MAX_HISTORY_CHARS) total -= turns.shift()!.text.length;
  return turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }],
  }));
}
