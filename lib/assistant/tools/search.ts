import 'server-only';

import { checkAiAllowed, consumeAllowance } from '../../ai-budget';
import { webSearch } from '../gemini';
import { asString, type ToolDefinition } from '../types';

const webSearchTool: ToolDefinition = {
  destructive: false,
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

export const searchTools: ToolDefinition[] = [webSearchTool];
