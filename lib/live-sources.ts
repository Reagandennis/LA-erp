/**
 * Which records each screen shows, for live updates. Client-safe.
 *
 * The server announces the *models* that changed (see lib/live-events.ts). A
 * screen refreshes when one of them is among its sources. A source is a model
 * name prefix ("Trip" covers Trip, TripItineraryItem, TripAssignment…), or a
 * suffix when written with a leading star ("*Notification").
 *
 * Lists err on the generous side: an extra refresh costs one cheap request,
 * while a missing source leaves a screen stale. A screen with no entry
 * refreshes on any change.
 */

/** The live-stream event that names the models that just changed. */
export const CHANGED_EVENT = 'changed';

export interface ChangedPayload {
  models: string[];
  at: number;
}

/** Access changes redraw the sidebar and can open or close a page, wherever you are. */
const ACCESS = ['UserModule', 'UserRole', 'RoleModule', 'RolePermission', 'Module', 'Role'];

const PEOPLE = ['Personnel', 'DriverLicense', 'Driver', 'Officer', 'User'];

export const MODULE_SOURCES: Record<string, readonly string[]> = {
  // Productivity
  'todo-personal': ['PersonalTodo'],
  notes: ['Note'],
  calendar: ['CalendarEvent', 'PersonalTodo'],
  'notification-center': ['*Notification'],
  'file-upload': ['StoredFile', 'FileNotification'],
  'ai-chatbot': [],

  // Operations
  'ops-dashboard': ['Trip', 'Vehicle', 'Driver', 'Officer', 'HandoverEntry', 'PersonalTodo', 'MessagingAccount', 'Map', 'Traveler'],
  handover: ['HandoverEntry'],
  map: ['Map'],
  'trip-planning': ['Trip', 'Traveler', 'Vehicle', 'Driver', 'Officer', 'Personnel', 'Customer', 'Quote'],
  'trip-closeout': ['Trip'],
  'task-assignment': ['Trip', 'Vehicle', 'Driver', 'Officer', 'Personnel'],
  'task-log-entry': ['Trip', 'HandoverEntry'],
  travelers: ['Traveler', 'TripTraveler', 'TripItemTraveler', 'Customer'],
  intel: ['IntelAssessment'],
  sops: ['Sop'],
  'flight-tracker': ['Trip'],

  // Fleet
  vehicles: ['Vehicle', 'TripAssignment', 'Driver'],
  'car-fuel': ['Vehicle'],
  'car-maintenance': ['Vehicle'],

  // Workforce and time
  personnel: PEOPLE,
  drivers: PEOPLE,
  cpos: PEOPLE,
  'airport-greeters': PEOPLE,
  'security-advisors': PEOPLE,
  'drivers-license-expiry': ['DriverLicense', 'Personnel'],
  'shift-planning': ['Shift', 'PublicHoliday'],
  'shift-planning-admin': ['Shift', 'PublicHoliday', 'User'],

  // Sales and finance
  quotes: ['Quote', 'Customer', 'Contact', 'Product', 'BrandProfile', 'OrganizationSettings', 'Deal'],
  'invoices-review': ['Invoice', 'Quote', 'Customer', 'BrandProfile', 'QuickBooksConnection', 'WaveConnection', 'OrganizationSettings'],
  customers: ['Customer', 'Contact', 'Deal', 'CrmActivity', 'Quote', 'Invoice'],
  'contact-list': ['Contact', 'Customer'],
  'products-services': ['Product', 'ServiceCatalogImport'],
  'contract-renewal': ['Contract'],
  reports: ['Quote', 'Invoice', 'Trip', 'Customer', 'Deal', 'Vehicle', 'Feedback'],

  // Communication
  'bulletin-board': ['Bulletin'],
  feedback: ['Feedback'],
  whatsapp: ['MessagingAccount'],
  telegram: ['MessagingAccount'],
  signal: ['MessagingAccount'],
  // Chat has its own live stream; a second refresh would only fight it.
  communication: [],
  'radio-zello': ['ZelloActivity'],

  // Screens still to be built: nothing on them to refresh.
  'task-list': [],
  filters: [],
  kpis: [],
  'certificate-expiry': [],
  'sales-metrics': [],
  'finance-metrics': [],

  // Nothing shared to wait on: clocks, timers and outside feeds.
  clock: [],
  'clock-in-out': [],
  'countdown-timer': [],
  phone: [],
  weather: [],
  'vendors-suppliers': [],
  'google-drive-storage': [],
};

const DASHBOARD_SOURCES = ['Quote', 'Invoice', 'HandoverEntry', 'ShiftLeave', 'Trip', 'DriverLicense', 'Contract', 'CalendarEvent', 'PersonalTodo', 'Bulletin'];
const ADMIN_SOURCES = ['User', 'Role', 'Module', 'Permission', 'OrganizationSettings', 'BackupSettings', 'BackupRun', 'AiSettings', 'UploadLimitSettings', 'BrandProfile', 'MessagingAccount'];

/** What a screen waits on, or null when it should refresh on any change. */
export function sourcesForPath(pathname: string): readonly string[] | null {
  const slug = pathname.match(/^\/modules\/([^/?#]+)/)?.[1];
  if (slug) return MODULE_SOURCES[slug] ?? null;
  if (pathname === '/dashboard' || pathname === '/') return DASHBOARD_SOURCES;
  if (pathname.startsWith('/admin')) return ADMIN_SOURCES;
  return null;
}

export function matchesSource(model: string, sources: readonly string[]): boolean {
  return sources.some((source) => (source.startsWith('*') ? model.endsWith(source.slice(1)) : model.startsWith(source)));
}

/** True when any of the changed models belongs to this screen. */
export function touches(models: readonly string[], sources: readonly string[] | null): boolean {
  if (sources === null) return models.length > 0;
  return models.some((model) => matchesSource(model, sources));
}

/** True when the change alters who may open what, which every screen cares about. */
export function touchesAccess(models: readonly string[]): boolean {
  return models.some((model) => ACCESS.includes(model));
}
