import 'server-only';

import { bulletinTools } from './tools/bulletin';
import { calendarTools } from './tools/calendar';
import { crmTools } from './tools/crm';
import { customerTools } from './tools/customers';
import { sopTools, travelerTools, vendorTools } from './tools/directory';
import { feedbackTools } from './tools/feedback';
import { fleetTools } from './tools/fleet';
import { cardTools, fuelTools, licenceTools, maintenanceTools } from './tools/fleet-ops';
import { flightTools } from './tools/flights';
import { closeoutTools, intelTools, opsBoardTools, reportTools, taskLogTools } from './tools/insight';
import { invoiceTools } from './tools/invoices';
import { internalMessagingTools } from './tools/messaging';
import { productTools } from './tools/products';
import { quoteTools } from './tools/quotes';
import { searchTools } from './tools/search';
import { shiftTools } from './tools/shifts';
import { todoTools } from './tools/todos';
import { trackingTools } from './tools/tracking';
import { tripTools } from './tools/trips';
import {
  contactTools,
  contractTools,
  dueDateTools,
  fileTools,
  handoverTools,
  noteTools,
  personnelTools,
} from './tools/workspace';
import type { ToolDefinition } from './types';

/**
 * A part of the platform the assistant can work in. The model holds only the
 * core tools and the areas a conversation needs: sending every tool on every
 * step is what a message costs, so each area is loaded when it is asked for.
 */
export interface ToolArea {
  id: string;
  /** How people name it: "Trip Planning". */
  label: string;
  /** What the model reads to decide whether to load it. */
  summary: string;
  /** Words in a message that mean this area is wanted, so it is loaded without a step spent asking. */
  hint?: RegExp;
  tools: ToolDefinition[];
}

export const AREAS: ToolArea[] = [
  {
    id: 'trips',
    label: 'Trip Planning',
    summary: 'trips and their itinerary: events (pickups, transfers, flights, hotels, activities), days, crew on an event, travellers, status and dates',
    hint: /\btrips?\b|itinerar|pick-?up|drop-?off|transfer/i,
    tools: tripTools,
  },
  {
    id: 'fleet',
    label: 'Task Assignment and Vehicles',
    summary: 'the registers of vehicles, drivers and close protection officers (add, edit, status), and trip-level assignments. Crew for a trip event is found in trips',
    hint: /vehicle|\bcars?\b|fleet|assignment/i,
    tools: fleetTools,
  },
  {
    id: 'clients',
    label: 'Clients',
    summary: 'client records: create, edit, find',
    hint: /client|customer/i,
    tools: customerTools,
  },
  {
    id: 'crm',
    label: 'CRM',
    summary: 'the sales pipeline: deals, stages, activities, client entities',
    hint: /\bdeals?\b|pipeline|\bcrm\b|\bleads?\b/i,
    tools: crmTools,
  },
  {
    id: 'quotes',
    label: 'Quotes',
    summary: 'quotes: create, edit lines, submit for approval, approve or decline, send',
    hint: /quot(e|ation)/i,
    tools: quoteTools,
  },
  {
    id: 'invoices',
    label: 'Invoices',
    summary: 'invoices: create, edit lines, approval, send, payments, void',
    hint: /invoice|payment|\bpaid\b|overdue|\bbill(ed|ing)?\b/i,
    tools: invoiceTools,
  },
  {
    id: 'products',
    label: 'Products & Services',
    summary: 'the catalogue of products and services and their prices',
    hint: /product|catalog|price list/i,
    tools: productTools,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    summary: "the user's calendar events and reminders",
    hint: /calendar|meeting|appointment|remind me/i,
    tools: calendarTools,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    summary: "the user's personal tasks board, and the log of completed and deleted tasks",
    hint: /\btasks?\b|to-?dos?\b/i,
    tools: [...todoTools, ...taskLogTools],
  },
  { id: 'notes', label: 'Notes', summary: "the user's own notes: read, add, edit, delete", hint: /\bmy notes?\b|\bnote to self\b|\bjot\b/i, tools: noteTools },
  {
    id: 'contacts',
    label: 'Contact List',
    summary: 'the contact directory (people at clients, vendors, partners): find, add, edit',
    hint: /contact|phone number|email address/i,
    tools: contactTools,
  },
  { id: 'files', label: 'File Upload', summary: "the user's uploaded files", hint: /\bfiles?\b|upload|document/i, tools: fileTools },
  {
    id: 'deadlines',
    label: 'Notification Center',
    summary: 'upcoming and overdue due dates across the platform',
    hint: /due date|deadline|expir|what.s due|coming up/i,
    tools: dueDateTools,
  },
  {
    id: 'people',
    label: 'Personnel',
    summary: 'the staff directory: drivers, officers, greeters, advisors and office staff, with contact details',
    hint: /personnel|staff|employee|who is\b/i,
    tools: personnelTools,
  },
  {
    id: 'contracts',
    label: 'Contract Renewal',
    summary: 'contracts and their renewal dates: find, edit, renew (adding one is for admins)',
    hint: /contract|\bnda\b|renewal/i,
    tools: contractTools,
  },
  {
    id: 'handover',
    label: 'Handover',
    summary: 'shift handover log: read, write a handover, acknowledge one',
    hint: /handover|hand-over/i,
    tools: handoverTools,
  },
  {
    id: 'feedback',
    label: 'Feedback',
    summary: 'feedback and improvement requests about the platform: read, file, comment',
    hint: /feedback|feature request|\bbug\b/i,
    tools: feedbackTools,
  },
  // Read-only areas: the rest of the platform, to look things up in.
  {
    id: 'shifts',
    label: 'Shift Planning',
    summary: "the user's own shifts and leave; for schedulers, everyone's roster and leave",
    hint: /\bshifts?\b|\brota\b|roster|on call|on duty|day off|\bleave\b|who.s (on|working)/i,
    tools: shiftTools,
  },
  {
    id: 'bulletin',
    label: 'Bulletin Board',
    summary: 'company notices on the Bulletin Board: list and read',
    hint: /bulletin|notices?\b|announcement|\bmemo\b/i,
    tools: bulletinTools,
  },
  {
    id: 'maintenance',
    label: 'Car Maintenance',
    summary: 'vehicle maintenance jobs, what is overdue or due, costs, odometer readings',
    hint: /maintenance|servic(e|ing)\b|garage|repair|inspection|odometer|mileage|tyres?/i,
    tools: maintenanceTools,
  },
  {
    id: 'fuel',
    label: 'Car Fuel, Fuel Cards and Parking Cards',
    summary: 'fill-ups and fuel spend; fuel and parking card balances and statements',
    hint: /fuel|fill-?ups?|litres?|petrol|diesel|parking|\btoll\b|top-?ups?|card balance/i,
    tools: [...fuelTools, ...cardTools],
  },
  {
    id: 'licences',
    label: 'Drivers License Expiry',
    summary: "drivers' licences and which are expired or expiring",
    hint: /licen[cs]es?/i,
    tools: licenceTools,
  },
  {
    id: 'travellers',
    label: 'Travelers',
    summary: 'the directory of travellers we protect: find one, read their record',
    hint: /travell?ers?|protectee|principal|passenger|passport|\bvip\b/i,
    tools: travelerTools,
  },
  {
    id: 'vendors',
    label: 'Vendors/Suppliers',
    summary: 'the vendor register: suppliers, their services, vehicles and people',
    hint: /vendors?|suppliers?|sub-?contract/i,
    tools: vendorTools,
  },
  {
    id: 'sops',
    label: 'Access to SOPs',
    summary: 'standard operating procedures: find and read the steps',
    hint: /\bsops?\b|procedure|protocol/i,
    tools: sopTools,
  },
  {
    id: 'intel',
    label: 'Intel',
    summary: 'saved location and security risk assessments: list and read (cannot run a new one)',
    hint: /\bintel\b|risk assessment|security assessment|threat|how safe/i,
    tools: intelTools,
  },
  {
    id: 'reports',
    label: 'Reports',
    summary: 'organisation-wide figures: billed, collected, outstanding, quoted, conversion, utilisation',
    hint: /reports?\b|revenue|turnover|figures|how much (have|did) we|conversion rate|utili[sz]ation|\bkpis?\b/i,
    tools: reportTools,
  },
  {
    id: 'ops',
    label: 'Ops Dashboard and Trip Close Out',
    summary: "today's operations: active trips, movements, crew gaps, flights, handovers; trips awaiting close-out",
    hint: /ops (dashboard|board)|operations|what.s (happening|on) today|movements?\b|crew gaps?|close-?out|closed out/i,
    tools: [...opsBoardTools, ...closeoutTools],
  },
  {
    id: 'flights',
    label: 'Flight Tracker',
    summary: 'look up a flight by number (paid, limited): route, times, whether it flew',
    hint: /flight (number|status)|tail number|callsign|has .* landed|landing time|\b[A-Z]{2}\s?\d{2,4}\b/,
    tools: flightTools,
  },
  {
    id: 'map',
    label: 'Map',
    summary: 'tracked vehicles, radios and phones and their last known positions',
    hint: /\bmap\b|track(er|ers|ing|ed)|where is|whereabouts|location of|\bgps\b|last (seen|position)/i,
    tools: trackingTools,
  },
  {
    id: 'messages',
    label: 'Communication',
    summary: "the user's own internal conversations and messages: read only, cannot send",
    hint: /internal (chat|message)|my (messages|chats|conversations)|unread messages?|inbox/i,
    tools: internalMessagingTools,
  },
];

/** In the model's hands on every step: finding things, and the web. */
export const CORE_TOOLS: ToolDefinition[] = [...searchTools];

export const ALL_TOOLS: ToolDefinition[] = [...AREAS.flatMap((area) => area.tools), ...CORE_TOOLS];

export function areaOfTool(name: string): ToolArea | undefined {
  return AREAS.find((area) => area.tools.some((tool) => tool.functionDeclaration.name === name));
}
