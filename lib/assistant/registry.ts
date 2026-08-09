import 'server-only';

import { calendarTools } from './tools/calendar';
import { crmTools } from './tools/crm';
import { customerTools } from './tools/customers';
import { feedbackTools } from './tools/feedback';
import { fleetTools } from './tools/fleet';
import { invoiceTools } from './tools/invoices';
import { productTools } from './tools/products';
import { quoteTools } from './tools/quotes';
import { searchTools } from './tools/search';
import { todoTools } from './tools/todos';
import { tripTools } from './tools/trips';
import { workspaceTools } from './tools/workspace';
import type { ToolDefinition } from './types';

export const ALL_TOOLS: ToolDefinition[] = [
  ...customerTools,
  ...crmTools,
  ...quoteTools,
  ...invoiceTools,
  ...tripTools,
  ...fleetTools,
  ...productTools,
  ...calendarTools,
  ...feedbackTools,
  ...todoTools,
  ...workspaceTools,
  ...searchTools,
];
