/**
 * The Ops Dashboard's panels and the module each one needs. Client-safe: the
 * board's layout menu and the API's `?panels=` both read it.
 */

export const OPS_PANELS = ['trips', 'movements', 'flights', 'whatsapp', 'handover', 'tasks', 'maintenance', 'fuel'] as const;

export type OpsPanelKey = (typeof OPS_PANELS)[number];

/** Holding this module shows the panel (admins see them all). */
export const PANEL_MODULE: Record<OpsPanelKey, string> = {
  movements: 'trip-planning',
  trips: 'trip-planning',
  flights: 'trip-planning',
  whatsapp: 'whatsapp',
  handover: 'handover',
  tasks: 'todo-personal',
  maintenance: 'car-maintenance',
  fuel: 'car-fuel',
};

export const PANEL_TITLE: Record<OpsPanelKey, string> = {
  movements: 'Movements',
  trips: 'Trip board',
  flights: 'Flights',
  whatsapp: 'WhatsApp',
  handover: 'Shift handover',
  tasks: 'Tasks',
  maintenance: 'Car maintenance',
  fuel: 'Car fuel',
};

/** The sidebar icon each panel wears (a module slug from app/ui/module-icons). */
export const PANEL_ICON: Record<OpsPanelKey, string> = { ...PANEL_MODULE, flights: 'flight-tracker' };

export function isOpsPanel(value: unknown): value is OpsPanelKey {
  return typeof value === 'string' && (OPS_PANELS as readonly string[]).includes(value);
}

/** "trips,tasks" → the known panels named, in board order; null when none were asked for. */
export function parsePanels(raw: string | null): OpsPanelKey[] | null {
  if (raw === null) return null;
  const named = new Set(raw.split(',').map((s) => s.trim()));
  return OPS_PANELS.filter((key) => named.has(key));
}
