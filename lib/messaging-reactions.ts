/**
 * The emoji the console lets people react with. Shared by the client (the
 * picker) and the server (which accepts nothing else), so it must stay free
 * of server-only imports.
 *
 * WhatsApp accepts any single emoji; limiting the console to these keeps the
 * request body from reaching wacli as free text.
 */
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJI as readonly string[]).includes(value);
}
