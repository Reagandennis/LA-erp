import 'server-only';

import { calendarTools } from './tools/calendar';
import { customerTools } from './tools/customers';
import { feedbackTools } from './tools/feedback';
import { fleetTools } from './tools/fleet';
import { invoiceTools } from './tools/invoices';
import { productTools } from './tools/products';
import { quoteTools } from './tools/quotes';
import { searchTools } from './tools/search';
import { todoTools } from './tools/todos';
import { tripTools } from './tools/trips';
import type { ToolDefinition } from './types';

export const ALL_TOOLS: ToolDefinition[] = [
  ...customerTools,
  ...quoteTools,
  ...invoiceTools,
  ...tripTools,
  ...fleetTools,
  ...productTools,
  ...calendarTools,
  ...feedbackTools,
  ...todoTools,
  ...searchTools,
];
