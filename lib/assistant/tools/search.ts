import 'server-only';

import { MAX_QUERY, MIN_QUERY, searchEverything } from '@/lib/search';

import { checkAiAllowed, consumeAllowance } from '../../ai-budget';
import { webSearch } from '../gemini';
import { asString, type ToolDefinition } from '../types';

/**
 * The platform's own search (the box in the header), so the assistant finds a
 * record by name or reference the same way a person does, and only among what
 * that person may see.
 */
const searchPlatformTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  functionDeclaration: {
    name: 'search_platform',
    description:
      'Find records anywhere in the platform by name, reference, number or keyword: trips, quotes, invoices, clients, contacts, people, travellers, vehicles, contracts, tasks, notes, files, SOPs, bulletin posts, handovers, products, calendar events and chats. ' +
      'Returns each match with its type, numeric id and a link. Use it first whenever the user names a record. Search one name or reference at a time, not a sentence.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A name, reference or keyword (2 to 80 characters)' } },
      required: ['query'],
    },
  },
  async handler(args, ctx) {
    const query = asString(args.query);
    if (!query || query.length < MIN_QUERY) return { error: `Search for at least ${MIN_QUERY} characters.` };
    const groups = await searchEverything(ctx.user, query.slice(0, MAX_QUERY));
    const results = groups.flatMap((group) =>
      group.hits.map((hit) => {
        const id = /-(\d+)$/.exec(hit.id)?.[1];
        return {
          type: group.label,
          id: id ? Number(id) : hit.id,
          title: hit.title,
          details: hit.subtitle,
          href: hit.href,
        };
      }),
    );
    if (results.length === 0) {
      return { results: [], note: `Nothing matches "${query}" in the areas this user can see. Try a shorter or different term.` };
    }
    return { results };
  },
};

const webSearchTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  functionDeclaration: {
    name: 'web_search',
    description:
      'Search the web (Google) for current or external information the platform does not hold — news, facts, prices, addresses, weather, etc. Only use when the answer is not in the platform data.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up' } },
      required: ['query'],
    },
  },
  async handler(args, ctx) {
    const query = asString(args.query);
    if (!query) return { error: 'A search query is required.' };
    // Grounded searches beyond Google's free monthly allowance are billed per
    // request, so there is a shared daily cap on top of the AI budget.
    const allowed = await checkAiAllowed('web_search');
    if (!allowed.ok) return { error: allowed.reason };
    const allowance = await consumeAllowance('web_search', ctx.userId);
    if (!allowance.ok) return { error: `${allowance.reason} Answer from the platform's own data instead.` };
    const { answer, error } = await webSearch(query, ctx.userId);
    if (error) return { error };
    return { answer };
  },
};

/** Always in the model's hands, whatever areas are loaded. */
export const searchTools: ToolDefinition[] = [searchPlatformTool, webSearchTool];
