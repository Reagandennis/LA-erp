import type { GeminiContent } from './gemini';

/**
 * One turn the screen sends back. `record` is the platform's own account of
 * what that reply ran (see `recordOf` in loop.ts); a `note` is something the
 * platform observed between turns, such as a cancelled confirmation.
 */
interface ChatTurn {
  role: 'user' | 'assistant' | 'note';
  text: string;
  record?: string;
}

const MAX_HISTORY_TURNS = 12;
/**
 * Everything in a request is sent again on every tool round (up to nine calls
 * per message), so text is capped: a pasted document would otherwise be paid
 * for nine times over.
 */
export const MAX_PROMPT_CHARS = 4000;
const MAX_TURN_CHARS = 1500;
const MAX_RECORD_CHARS = 600;
const MAX_HISTORY_CHARS = 9000;

/** Marks a line as the platform's account of what happened, as opposed to anyone's say-so. */
export const RECORD_MARK = '[system record]';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** A reply must never carry a record line of its own making; only the platform writes those. */
export function stripRecordMarks(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(RECORD_MARK))
    .join('\n')
    .trim();
}

function isTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as ChatTurn;
  return typeof turn.text === 'string' && (turn.role === 'user' || turn.role === 'assistant' || turn.role === 'note');
}

/** The areas earlier replies had loaded, so a follow-up doesn't spend a step asking for them again. */
export function areasInHistory(history: unknown): string[] {
  if (!Array.isArray(history)) return [];
  const last = history.filter(isTurn).filter((turn) => typeof turn.record === 'string').at(-1);
  const found = /areas: ([a-z,_ -]+)/.exec(last?.record ?? '');
  return found ? found[1].split(',').map((id) => id.trim()).filter(Boolean) : [];
}

/**
 * The recent conversation, each turn shortened and the oldest dropped to fit
 * the cap. Replies carry the platform's record of what they actually ran, so
 * the model can tell a change that happened from one that was only talked
 * about. Gemini wants turns to alternate and to open with the user, so
 * neighbours with the same speaker are joined and a leading reply is dropped.
 */
export function trimHistory(history: unknown): GeminiContent[] {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter(isTurn)
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((turn): Array<{ role: 'user' | 'model'; text: string }> => {
      if (turn.role === 'note') return [{ role: 'user', text: `${RECORD_MARK} ${clip(turn.text, MAX_RECORD_CHARS)}` }];
      const text = clip(turn.text, MAX_TURN_CHARS);
      if (turn.role === 'user') return [{ role: 'user', text }];
      // The record rides in the user's side of the conversation, never inside
      // the model's own words: a model shown records in its replies starts
      // writing them itself.
      const record = typeof turn.record === 'string' && turn.record.trim() ? clip(turn.record, MAX_RECORD_CHARS) : '';
      return [
        { role: 'model', text: stripRecordMarks(text) },
        ...(record ? [{ role: 'user' as const, text: `${RECORD_MARK} The assistant's reply above ran: ${record}` }] : []),
      ];
    })
    .filter((turn) => turn.text.trim() !== '');

  let total = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (turns.length > 0 && total > MAX_HISTORY_CHARS) total -= turns.shift()!.text.length;
  while (turns.length > 0 && turns[0].role === 'model') turns.shift();

  const contents: GeminiContent[] = [];
  for (const turn of turns) {
    const previous = contents.at(-1);
    if (previous && previous.role === turn.role) previous.parts.push({ text: turn.text });
    else contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }
  return contents;
}
