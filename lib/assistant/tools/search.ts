import 'server-only';

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
  async handler(args) {
    const query = asString(args.query);
    if (!query) return { error: 'A search query is required.' };
    const { answer, error } = await webSearch(query);
    if (error) return { error };
    return { answer };
  },
};

export const searchTools: ToolDefinition[] = [webSearchTool];
