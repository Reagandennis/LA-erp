import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const lib = vi.hoisted(() => ({
  // Shift planning
  currentMonth: vi.fn(),
  myShifts: vi.fn(),
  teamRoster: vi.fn(),
  listLeaves: vi.fn(),
  // Bulletin
  listPosts: vi.fn(),
  getPost: vi.fn(),
  markRead: vi.fn(),
  // Fleet
  listMaintenance: vi.fn(),
  listFuelLogs: vi.fn(),
  listVehicleOdometers: vi.fn(),
  listFleetVehicles: vi.fn(),
  listFuelCards: vi.fn(),
  getFuelCardStatement: vi.fn(),
  listParkingCards: vi.fn(),
  getParkingStatement: vi.fn(),
  listDriverLicenses: vi.fn(),
  // Directory
  searchTravelers: vi.fn(),
  getTravelerById: vi.fn(),
  getVendorRegister: vi.fn(),
  listCatalogServices: vi.fn(),
  listSops: vi.fn(),
  getSop: vi.fn(),
  acknowledgeSop: vi.fn(),
  // Insight
  listAssessments: vi.fn(),
  getAssessment: vi.fn(),
  createAssessment: vi.fn(),
  getReportData: vi.fn(),
  getRates: vi.fn(),
  getOrganizationSettings: vi.fn(),
  loadOpsDashboard: vi.fn(),
  listCloseoutTrips: vi.fn(),
  listTaskLogEntries: vi.fn(),
  // Flights
  lookupFlights: vi.fn(),
  classifyQuery: vi.fn(),
  enforceRateLimit: vi.fn(),
  // Map
  listTrackedDevices: vi.fn(),
  // Internal messaging
  listConversationsForUser: vi.fn(),
  listMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

const { FlightTrackingError } = vi.hoisted(() => ({
  FlightTrackingError: class FlightTrackingError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('../lib/audit', () => ({ recordAuditEvent: lib.recordAuditEvent }));
vi.mock('../lib/user', () => ({
  userHasRole: (user: { roles: { name: string }[] }, role: string) => user.roles.some((r) => r.name === role),
  userHasModule: (user: { modules: { slug: string }[] }, slug: string) => user.modules.some((m) => m.slug === slug),
}));
// The gate itself (canUseTool) is the real one; the registry it sits beside is not under test here.
vi.mock('../lib/assistant/registry', () => ({ ALL_TOOLS: [], AREAS: [], CORE_TOOLS: [] }));

vi.mock('../lib/shift-planning', () => ({
  currentMonth: lib.currentMonth,
  myShifts: lib.myShifts,
  teamRoster: lib.teamRoster,
  listLeaves: lib.listLeaves,
}));
vi.mock('../lib/bulletin', () => ({
  BULLETIN_CATEGORIES: ['Announcement', 'Notice', 'Safety', 'Event', 'Policy', 'Reminder'],
  listPosts: lib.listPosts,
  getPost: lib.getPost,
  markRead: lib.markRead,
}));
vi.mock('../lib/fleet-server', () => ({
  listMaintenance: lib.listMaintenance,
  listFuelLogs: lib.listFuelLogs,
  listVehicleOdometers: lib.listVehicleOdometers,
  listFleetVehicles: lib.listFleetVehicles,
}));
vi.mock('../lib/fuel-cards-server', () => ({ listFuelCards: lib.listFuelCards, getFuelCardStatement: lib.getFuelCardStatement }));
vi.mock('../lib/parking-cards-server', () => ({ listParkingCards: lib.listParkingCards, getParkingStatement: lib.getParkingStatement }));
vi.mock('../lib/drivers', () => ({ listDriverLicenses: lib.listDriverLicenses }));
vi.mock('../lib/travelers', () => ({ searchTravelers: lib.searchTravelers, getTravelerById: lib.getTravelerById }));
vi.mock('../lib/vendors', () => ({ getVendorRegister: lib.getVendorRegister, listCatalogServices: lib.listCatalogServices }));
vi.mock('../lib/sops', () => ({
  SOP_CATEGORIES: ['Safety', 'Operations', 'Human Resources', 'IT & Security', 'Finance'],
  SOP_STATUSES: ['Draft', 'Review', 'Active', 'Archived'],
  listSops: lib.listSops,
  getSop: lib.getSop,
  acknowledgeSop: lib.acknowledgeSop,
}));
vi.mock('../lib/intel', () => ({
  RISK_LEVELS: ['Low', 'Moderate', 'High', 'Extreme'],
  listAssessments: lib.listAssessments,
  getAssessment: lib.getAssessment,
  createAssessment: lib.createAssessment,
}));
vi.mock('../lib/reports', () => ({ getReportData: lib.getReportData }));
vi.mock('../lib/exchange-rates-server', () => ({ getRates: lib.getRates }));
vi.mock('../lib/organization', () => ({ getOrganizationSettings: lib.getOrganizationSettings }));
vi.mock('../lib/ops-dashboard', () => ({ loadOpsDashboard: lib.loadOpsDashboard }));
vi.mock('../lib/trip-closeout', () => ({ listCloseoutTrips: lib.listCloseoutTrips }));
vi.mock('../lib/task-log', () => ({ listTaskLogEntries: lib.listTaskLogEntries }));
vi.mock('../lib/flight-lookup', () => ({ lookupFlights: lib.lookupFlights, classifyQuery: lib.classifyQuery }));
vi.mock('../lib/flight-tracking', () => ({ FlightTrackingError }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit: lib.enforceRateLimit }));
vi.mock('../lib/tracked-devices', () => ({ listTrackedDevices: lib.listTrackedDevices }));
vi.mock('../lib/communication', () => ({
  listConversationsForUser: lib.listConversationsForUser,
  listMessages: lib.listMessages,
  markConversationRead: lib.markConversationRead,
  sendMessage: lib.sendMessage,
}));

import { executeTool } from '../lib/assistant/execute';
import { canUseTool } from '../lib/assistant/scope';
import { bulletinTools } from '../lib/assistant/tools/bulletin';
import { sopTools, travelerTools, vendorTools } from '../lib/assistant/tools/directory';
import { cardTools, fuelTools, licenceTools, maintenanceTools } from '../lib/assistant/tools/fleet-ops';
import { flightTools } from '../lib/assistant/tools/flights';
import { closeoutTools, intelTools, opsBoardTools, reportTools, taskLogTools } from '../lib/assistant/tools/insight';
import { internalMessagingTools } from '../lib/assistant/tools/messaging';
import { shiftTools } from '../lib/assistant/tools/shifts';
import { trackingTools } from '../lib/assistant/tools/tracking';
import { type ToolContext, type ToolDefinition, toolKind } from '../lib/assistant/types';
import { DEFAULT_RULES } from '../lib/shift-rules';
import type { AccessUser } from '../lib/user';

const ALL: ToolDefinition[] = [
  ...shiftTools,
  ...bulletinTools,
  ...maintenanceTools,
  ...fuelTools,
  ...cardTools,
  ...licenceTools,
  ...travelerTools,
  ...vendorTools,
  ...sopTools,
  ...intelTools,
  ...reportTools,
  ...opsBoardTools,
  ...closeoutTools,
  ...taskLogTools,
  ...flightTools,
  ...trackingTools,
  ...internalMessagingTools,
];

function person(options: { id?: number; roles?: string[]; modules?: string[] } = {}): AccessUser {
  return {
    id: options.id ?? 7,
    name: 'Amina',
    roles: (options.roles ?? []).map((name) => ({ name })),
    modules: (options.modules ?? []).map((slug) => ({ slug })),
  } as unknown as AccessUser;
}

function context(options: { id?: number; roles?: string[]; modules?: string[] } = {}): ToolContext {
  const user = person(options);
  return {
    userId: user.id,
    userName: user.name,
    isAdmin: (options.roles ?? []).includes('admin'),
    user,
    timeZone: 'Africa/Nairobi',
    request: {},
  } as unknown as ToolContext;
}

const ctx = context();
const tool = (name: string) => {
  const found = ALL.find((t) => t.functionDeclaration.name === name);
  if (!found) throw new Error(`No tool named ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown> = {}, as: ToolContext = ctx) => executeTool(tool(name), args, as);
const errorOf = (action: { result: unknown }) => (action.result as { error?: string }).error ?? '';
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const out = (action: { result: unknown }) => action.result as Record<string, any>;
const many = <T>(count: number, make: (index: number) => T): T[] => Array.from({ length: count }, (_, index) => make(index + 1));

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
  lib.currentMonth.mockResolvedValue('2026-12');
  lib.enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 60 });
  lib.classifyQuery.mockImplementation((raw: string) => (/\d/.test(raw) ? { kind: 'flight', value: raw.replace(/\s+/g, '').toUpperCase() } : null));
});

// --- Every tool here only reads -----------------------------------------------------

describe('the platform tools as a whole', () => {
  it('are all reads: none is a write, none asks for confirmation', () => {
    expect(ALL.length).toBeGreaterThan(25);
    for (const t of ALL) {
      expect(toolKind(t), t.functionDeclaration.name).toBe('read');
      expect(t.kind, t.functionDeclaration.name).toBe('read');
      expect(t.destructive, t.functionDeclaration.name).toBe(false);
      expect(t.confirmLabel, t.functionDeclaration.name).toBeUndefined();
    }
  });

  it('have distinct names, each behind a module gate', () => {
    const names = ALL.map((t) => t.functionDeclaration.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ALL) {
      expect(t.requiredModule, t.functionDeclaration.name).toBeTruthy();
      expect(t.functionDeclaration.name).toMatch(/^(list|get|find)_/);
    }
  });

  it('never send, post, acknowledge or generate anything, whatever is asked', async () => {
    lib.listMessages.mockResolvedValue([]);
    lib.listPosts.mockResolvedValue([]);
    lib.getPost.mockResolvedValue(null);
    lib.getSop.mockResolvedValue(null);
    lib.listAssessments.mockResolvedValue([]);
    await run('get_conversation_messages', { conversationId: 4 });
    await run('get_bulletin_post', { postId: 1 });
    await run('get_sop', { sopId: 1 });
    await run('list_intel_assessments');
    for (const write of [lib.sendMessage, lib.markConversationRead, lib.markRead, lib.acknowledgeSop, lib.createAssessment, lib.recordAuditEvent]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('refuse an argument they never declared rather than drop it', async () => {
    const action = await run('list_bulletin_posts', { title: 'Hello', body: 'Post this' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('is not something this tool can set');
    expect(lib.listPosts).not.toHaveBeenCalled();
  });
});

// --- Shift planning -----------------------------------------------------------------

const line = (id: number, code: string, name: string, position = 'trc') => ({
  id,
  code,
  name,
  position,
  userId: id + 100,
  email: null,
  displayName: null,
  cycleOffset: 0,
  startDate: null,
  endDate: null,
  active: true,
  contractHoursPerWeek: 48,
  leaveEntitlementDays: 21,
  leaveOpeningBalance: 0,
  sortOrder: id,
});

const record = (lineId: number, date: string, plannedCode: string, extra: Record<string, unknown> = {}) => ({
  id: Number(date.slice(8)) + lineId * 100,
  lineId,
  date,
  generatedCode: plannedCode,
  plannedCode,
  label: null,
  workedCode: null,
  status: 'planned',
  actualStart: null,
  actualEnd: null,
  hoursWorked: null,
  reasonCode: null,
  note: null,
  leaveId: null,
  callIn: null,
  ...extra,
});

const december = (lineId: number) =>
  many(31, (day) => record(lineId, `2026-12-${String(day).padStart(2, '0')}`, DEFAULT_RULES.pattern[(day - 1) % 10]!));

function shifts(overrides: Record<string, unknown> = {}) {
  return {
    today: '2026-12-03',
    rules: DEFAULT_RULES,
    line: line(1, 'TRC-1', 'Amina'),
    month: { month: '2026-12', status: 'published', generatedAt: 'x', publishedAt: 'x', publishDue: '2026-11-17' },
    records: december(1),
    upcoming: december(1).slice(1, 5),
    holidays: [
      { id: 'h1', date: '2026-12-12', name: 'Jamhuri Day', country: 'KE' },
      { id: 'h2', date: '2027-01-01', name: "New Year's Day", country: 'KE' },
    ],
    totals: { codes: {}, away: {}, shifts: 19, hours: 152, callIns: 0, nights: 6, weekendShifts: 5, holidayShifts: 1 },
    balance: { entitlement: 21, opening: 0, accrued: 19, taken: 5, pending: 2, balance: 14, away: {}, sick12m: 1, cto: { balance: 1.5 } },
    leaves: [{ id: 3, lineId: 1, lineCode: 'TRC-1', personName: 'Amina', type: 'annual', code: 'LV', startDate: '2026-12-20', endDate: '2026-12-21', status: 'pending', days: 2 }],
    ...overrides,
  };
}

describe('shift planning: my shifts', () => {
  it("reads the caller's own shifts for the month asked, and nobody else's", async () => {
    lib.myShifts.mockResolvedValue(shifts());
    const action = await run('get_my_shifts', { month: '2026-12' }, context({ id: 42, modules: ['shift-planning'] }));

    expect(lib.myShifts).toHaveBeenCalledWith(42, '2026-12');
    expect(lib.currentMonth).not.toHaveBeenCalled();
    expect(action.ok).toBe(true);
    expect(out(action)).toMatchObject({
      month: '2026-12',
      onRoster: true,
      line: 'TRC-1',
      position: 'Travel Risk Coordinator',
      published: true,
      totals: { shifts: 19, hours: 152, nights: 6 },
      leave: { annualBalanceDays: 14, annualPending: 2, compensatoryDaysBalance: 1.5 },
      holidays: [{ date: '2026-12-12', name: 'Jamhuri Day' }],
      leaveRequests: [{ id: 3, type: 'Annual leave', start: '2026-12-20', end: '2026-12-21', days: 2, status: 'pending' }],
      href: '/modules/shift-planning',
    });
    // The month as runs of codes, not a row per day.
    expect(out(action).days).toBe('1-2:D 3-4:S 5-6:N 7:X 8-9:OC 10:X 11-12:D 13-14:S 15-16:N 17:X 18-19:OC 20:X 21-22:D 23-24:S 25-26:N 27:X 28-29:OC 30:X 31:D');
    expect(out(action).codes).toMatchObject({ D: 'Day 07:00-15:00', N: 'Night 23:00-07:00', X: 'Off' });
    expect(out(action).upcoming).toEqual([
      { date: '2026-12-02', weekday: 'Wed', shift: 'D', name: 'Day', hours: '07:00-15:00' },
      { date: '2026-12-03', weekday: 'Thu', shift: 'S', name: 'Swing', hours: '15:00-23:00' },
      { date: '2026-12-04', weekday: 'Fri', shift: 'S', name: 'Swing', hours: '15:00-23:00' },
      { date: '2026-12-05', weekday: 'Sat', shift: 'N', name: 'Night', hours: '23:00-07:00' },
    ]);
  });

  it('uses the roster\'s current month when none is given', async () => {
    lib.myShifts.mockResolvedValue(shifts());
    await run('get_my_shifts');
    expect(lib.myShifts).toHaveBeenCalledWith(7, '2026-12');
  });

  it('says a month is not published instead of showing a draft', async () => {
    lib.myShifts.mockResolvedValue(shifts({ month: { month: '2027-01', status: 'none', generatedAt: null, publishedAt: null, publishDue: 'x' }, records: [], upcoming: [] }));
    const action = await run('get_my_shifts', { month: '2027-01' });
    expect(out(action)).toMatchObject({ published: false, note: expect.stringContaining('has not been published') });
    expect(out(action).days).toBeUndefined();
    expect(out(action).totals).toBeUndefined();
  });

  it('says so when the person is not on the roster', async () => {
    lib.myShifts.mockResolvedValue(shifts({ line: null, records: [], upcoming: [], balance: null, leaves: [] }));
    expect(out(await run('get_my_shifts'))).toMatchObject({ onRoster: false });
  });

  it.each(['December', '2026-13', '2026-1'])('refuses the month %j rather than read it as this month', async (month) => {
    const action = await run('get_my_shifts', { month });
    expect(errorOf(action)).toContain('month must be a month written YYYY-MM');
    expect(lib.myShifts).not.toHaveBeenCalled();
  });
});

describe('shift planning: the roster of everyone is the scheduler\'s', () => {
  const staff = person({ modules: ['shift-planning'] });
  const scheduler = person({ modules: ['shift-planning-admin'] });
  const admin = person({ roles: ['admin'] });

  it('is closed to staff and open to a scheduler or an admin, as the roster route is', () => {
    for (const name of ['get_shift_roster', 'list_shift_leave']) {
      expect(canUseTool(staff, tool(name)), name).toBe(false);
      expect(canUseTool(scheduler, tool(name)), name).toBe(true);
      expect(canUseTool(admin, tool(name)), name).toBe(true);
    }
    // Their own shifts: either module will do, as requireViewer has it.
    expect(canUseTool(staff, tool('get_my_shifts'))).toBe(true);
    expect(canUseTool(scheduler, tool('get_my_shifts'))).toBe(true);
    expect(canUseTool(person({ modules: ['calendar'] }), tool('get_my_shifts'))).toBe(false);
  });

  const roster = () => ({
    today: '2026-12-03',
    rules: DEFAULT_RULES,
    lines: [line(1, 'TRC-1', 'Amina'), line(2, 'TRC-2', 'Brian'), line(3, 'DRV-1', 'Chege', 'driver')],
    month: { month: '2026-12', status: 'draft', generatedAt: 'x', publishedAt: null, publishDue: 'x' },
    records: [...december(1), ...december(2).map((r, i) => ({ ...r, plannedCode: i === 2 ? 'LV' : r.plannedCode, label: i === 2 ? 'SL' : null, status: i === 2 ? 'sick' : 'planned' }))],
    holidays: [{ id: 'h1', date: '2026-12-12', name: 'Jamhuri Day', country: 'KE' }],
  });

  it('shows one day: who is on which shift', async () => {
    lib.teamRoster.mockResolvedValue(roster());
    const action = await run('get_shift_roster', { date: '2026-12-03' });
    expect(lib.teamRoster).toHaveBeenCalledWith('2026-12');
    expect(out(action)).toMatchObject({ month: '2026-12', date: '2026-12-03', status: 'draft', total: 2, more: false, href: '/modules/shift-planning-admin' });
    expect(out(action).people).toEqual([
      { line: 'TRC-1', person: 'Amina', position: 'Travel Risk Coordinator', shift: 'S', name: 'Swing', hours: '15:00-23:00' },
      { line: 'TRC-2', person: 'Brian', position: 'Travel Risk Coordinator', shift: 'SL', name: 'Sick leave', status: 'sick' },
    ]);
  });

  it('shows the month as one compact line a person, and searches by name', async () => {
    lib.teamRoster.mockResolvedValue(roster());
    const action = await run('get_shift_roster', { month: '2026-12', q: 'chege' });
    expect(out(action)).toMatchObject({ total: 1, people: [{ line: 'DRV-1', person: 'Chege', position: 'Driver', days: '1-31:-' }] });

    const everyone = out(await run('get_shift_roster', { month: '2026-12' }));
    expect(everyone.total).toBe(3);
    expect(everyone.people[1].days).toMatch(/^1-2:D 3:SL 4:S /);
  });

  it('refuses a date outside the month it was given with', async () => {
    const action = await run('get_shift_roster', { month: '2026-12', date: '2027-01-02' });
    expect(errorOf(action)).toContain('is not in month 2026-12');
    expect(lib.teamRoster).not.toHaveBeenCalled();
  });

  it('lists leave, filtered in the lib by date and here by status', async () => {
    const leave = (id: number, status: string, personName: string) => ({
      id, lineId: id, lineCode: `TRC-${id}`, personName, type: 'annual', code: 'LV', startDate: '2026-12-20', endDate: '2026-12-22', status, days: 3, note: null, requestedByName: personName, decidedByName: null,
    });
    lib.listLeaves.mockResolvedValue([leave(1, 'pending', 'Amina'), leave(2, 'approved', 'Brian'), leave(3, 'pending', 'Chege')]);
    const action = await run('list_shift_leave', { status: 'pending', from: '2026-12-01' });
    expect(lib.listLeaves).toHaveBeenCalledWith({ from: '2026-12-01' });
    expect(out(action)).toMatchObject({ total: 2, more: false, pending: 2 });
    expect(out(action).leave.map((l: { person: string }) => l.person)).toEqual(['Amina', 'Chege']);
    expect(out(action).leave[0]).toMatchObject({ type: 'Annual leave', start: '2026-12-20', end: '2026-12-22', days: 3, status: 'pending' });

    expect(errorOf(await run('list_shift_leave', { status: 'Approved' }))).toContain('status must be one of');
  });
});

// --- Bulletin board -----------------------------------------------------------------

const post = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Notice ${id}`,
  body: `Body of notice ${id}. `.repeat(20),
  category: 'Notice',
  pinned: false,
  expiresAt: null,
  expired: false,
  createdAt: '2026-11-23T21:30:00.000Z',
  updatedAt: '2026-11-23T21:30:00.000Z',
  author: { id: 2, name: 'Brian' },
  readCount: 4,
  readByMe: true,
  ...extra,
});

describe('bulletin board', () => {
  it('lists the board as the caller sees it, twenty at a time', async () => {
    lib.listPosts.mockResolvedValue(many(25, (i) => post(i, { readByMe: i > 3 })));
    const action = await run('list_bulletin_posts');
    expect(lib.listPosts).toHaveBeenCalledWith(7, { includeExpired: false });
    expect(out(action)).toMatchObject({ total: 25, page: 1, more: true, unread: 3, href: '/modules/bulletin-board' });
    expect(out(action).posts).toHaveLength(20);
    // 21:30 UTC is half past midnight the next day in Nairobi.
    expect(out(action).posts[0]).toMatchObject({ id: 1, title: 'Notice 1', category: 'Notice', author: 'Brian', posted: '2026-11-24 00:30', seenByUser: false });
    expect(out(action).posts[0].preview.length).toBeLessThanOrEqual(161);
    expect(out(action).posts[0].body).toBeUndefined();

    const second = out(await run('list_bulletin_posts', { page: 2 }));
    expect(second).toMatchObject({ page: 2, more: false });
    expect(second.posts).toHaveLength(5);
  });

  it('filters by category, words and unread, and can include expired notices', async () => {
    lib.listPosts.mockResolvedValue([post(1, { category: 'Safety', title: 'Fire drill' }), post(2, { category: 'Safety', readByMe: false }), post(3)]);
    const action = await run('list_bulletin_posts', { category: 'Safety', q: 'DRILL', includeExpired: true });
    expect(lib.listPosts).toHaveBeenCalledWith(7, { includeExpired: true });
    expect(out(action).posts.map((p: { id: number }) => p.id)).toEqual([1]);
    expect(out(await run('list_bulletin_posts', { unreadOnly: true })).posts.map((p: { id: number }) => p.id)).toEqual([2]);
    expect(errorOf(await run('list_bulletin_posts', { category: 'Gossip' }))).toContain('category must be one of');
  });

  it('reads one notice in full, with who has seen it', async () => {
    lib.getPost.mockResolvedValue({ ...post(9, { body: 'Gate B is closed until Friday.' }), readers: [{ id: 1, name: 'Amina', readAt: 'x' }, { id: 2, name: 'Brian', readAt: 'x' }] });
    const action = await run('get_bulletin_post', { postId: 9 });
    expect(lib.getPost).toHaveBeenCalledWith(9, 7);
    expect(out(action)).toMatchObject({ id: 9, text: 'Gate B is closed until Friday.', seenBy: 4, readers: ['Amina', 'Brian'], href: '/modules/bulletin-board' });
  });

  it('says so when the notice is not there', async () => {
    lib.getPost.mockResolvedValue(null);
    expect(errorOf(await run('get_bulletin_post', { postId: 99 }))).toContain('Notice 99 was not found');
  });
});

// --- Fleet: maintenance, fuel, cards, licences --------------------------------------

const vehicle = (id: number, registration: string) => ({ id, registration, make: 'Toyota', model: 'Prado' });

const job = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  vehicle: vehicle(1, 'KDA 111A'),
  kind: 'Scheduled',
  category: 'Service',
  title: `Service ${id}`,
  status: 'Completed',
  scheduledFor: null,
  completedAt: '2026-10-10',
  odometerKm: 80000,
  cost: 12000,
  currency: 'KES',
  provider: 'Toyota Kenya',
  nextDueAt: null,
  nextDueKm: null,
  reminderDays: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-10-10T08:00:00.000Z',
  ...extra,
});

describe('car maintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T09:00:00.000Z'));
    return () => vi.useRealTimers();
  });

  it('reads our own fleet, as the page does, and works out what is overdue', async () => {
    lib.listMaintenance.mockResolvedValue([
      job(1),
      job(2, { status: 'Planned', scheduledFor: '2026-11-20', completedAt: null, cost: null, vehicle: vehicle(2, 'KDB 222B') }),
      job(3, { status: 'Planned', scheduledFor: '2026-11-30', completedAt: null, cost: 5000 }),
      job(4, { status: 'In progress', scheduledFor: '2026-11-24', completedAt: null, cost: 300, currency: 'USD' }),
    ]);
    const action = await run('list_vehicle_maintenance');
    expect(lib.listMaintenance).toHaveBeenCalledWith({ internalOnly: true });
    expect(out(action)).toMatchObject({
      total: 4,
      more: false,
      overdue: 1,
      dueSoon: 1,
      inProgress: 1,
      costByCurrency: { KES: 17000, USD: 300 },
      today: '2026-11-24',
      href: '/modules/car-maintenance',
    });
    expect(out(action).jobs[1]).toMatchObject({ id: 2, vehicle: 'KDB 222B', status: 'Overdue', plannedFor: '2026-11-20' });
    expect(out(action).jobs[1].cost).toBeUndefined();

    expect(out(await run('list_vehicle_maintenance', { status: 'Overdue' })).jobs.map((j: { id: number }) => j.id)).toEqual([2]);
    expect(out(await run('list_vehicle_maintenance', { status: 'Open' })).total).toBe(3);
    expect(out(await run('list_vehicle_maintenance', { vehicleId: 2 })).total).toBe(1);
    expect(out(await run('list_vehicle_maintenance', { from: '2026-11-21', to: '2026-11-30' })).jobs.map((j: { id: number }) => j.id)).toEqual([3, 4]);
    expect(out(await run('list_vehicle_maintenance', { q: 'kdb' })).total).toBe(1);
  });

  it('refuses a status it does not know and a backwards date range', async () => {
    expect(errorOf(await run('list_vehicle_maintenance', { status: 'Done' }))).toContain('status must be one of');
    expect(errorOf(await run('list_vehicle_maintenance', { from: '2026-11-30', to: '2026-11-01' }))).toContain('to is before from');
    expect(errorOf(await run('list_vehicle_maintenance', { from: '30 Nov' }))).toContain('from must be a real date');
    expect(lib.listMaintenance).not.toHaveBeenCalled();
  });

  it('gives the latest odometer of each of our vehicles', async () => {
    lib.listFleetVehicles.mockResolvedValue([vehicle(1, 'KDA 111A'), vehicle(2, 'KDB 222B'), vehicle(3, 'KDC 333C')]);
    lib.listVehicleOdometers.mockResolvedValue({ 1: 80000, 2: 120500 });
    const action = await run('list_vehicle_odometers');
    expect(lib.listFleetVehicles).toHaveBeenCalledWith({ internalOnly: true });
    expect(out(action)).toMatchObject({ total: 3, more: false, withoutReading: 1 });
    expect(out(action).vehicles).toEqual([
      { vehicleId: 2, vehicle: 'KDB 222B', model: 'Toyota Prado', odometerKm: 120500 },
      { vehicleId: 1, vehicle: 'KDA 111A', model: 'Toyota Prado', odometerKm: 80000 },
      { vehicleId: 3, vehicle: 'KDC 333C', model: 'Toyota Prado', odometerKm: null },
    ]);
  });

  it('is gated on Car Maintenance alone', () => {
    expect(canUseTool(person({ modules: ['car-fuel'] }), tool('list_vehicle_maintenance'))).toBe(false);
    expect(canUseTool(person({ modules: ['car-fuel'] }), tool('list_vehicle_odometers'))).toBe(false);
    expect(canUseTool(person({ modules: ['car-maintenance'] }), tool('list_vehicle_maintenance'))).toBe(true);
  });
});

const fill = (id: number, filledAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  vehicle: vehicle(1, 'KDA 111A'),
  filledAt,
  litres: 50,
  cost: 9000,
  currency: 'KES',
  odometerKm: null,
  fuelType: 'Diesel',
  fullTank: true,
  station: 'Shell Westlands',
  filledBy: 'John',
  notes: null,
  fuelCard: null,
  createdBy: null,
  createdAt: filledAt,
  ...extra,
});

describe('car fuel', () => {
  it('lists fill-ups with totals, by vehicle and by the local day they happened', async () => {
    lib.listFuelLogs.mockResolvedValue([
      // 22:30 UTC on the 24th is the 25th in Nairobi.
      fill(3, '2026-11-24T22:30:00.000Z', { odometerKm: 81000, fuelCard: { id: 5, name: 'Shell 01' } }),
      fill(2, '2026-11-20T06:00:00.000Z', { vehicle: vehicle(2, 'KDB 222B'), cost: null }),
      fill(1, '2026-11-10T06:00:00.000Z', { odometerKm: 80500 }),
    ]);
    const all = await run('list_fuel_logs');
    expect(lib.listFuelLogs).toHaveBeenCalledWith();
    expect(out(all)).toMatchObject({ total: 3, more: false, litres: 150, spendByCurrency: { KES: 18000 }, href: '/modules/car-fuel' });
    expect(out(all).fillUps[0]).toMatchObject({ id: 3, vehicle: 'KDA 111A', when: '2026-11-25 01:30', litres: 50, cost: 9000, paidWith: 'Shell 01', kmPerLitre: 10 });

    expect(out(await run('list_fuel_logs', { from: '2026-11-25' })).fillUps.map((f: { id: number }) => f.id)).toEqual([3]);
    expect(out(await run('list_fuel_logs', { to: '2026-11-24' })).total).toBe(2);
    expect(out(await run('list_fuel_logs', { vehicleId: 2 }))).toMatchObject({ total: 1, litres: 50, spendByCurrency: {} });
  });

  it('pages a long history', async () => {
    lib.listFuelLogs.mockResolvedValue(many(45, (i) => fill(i, '2026-11-01T06:00:00.000Z')));
    expect(out(await run('list_fuel_logs', { page: 3 }))).toMatchObject({ total: 45, page: 3, more: false });
    expect(out(await run('list_fuel_logs', { page: 2 })).fillUps).toHaveLength(20);
  });
});

const fuelCard = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Shell 0${id}`,
  provider: 'Shell',
  entity: 'LADYASKARI',
  vehicle: { id: 1, registration: 'KDA 111A' },
  cardNumber: '7002 1234 5678 9012',
  lowBalanceThreshold: 5000,
  active: true,
  notes: null,
  loaded: 50000,
  spent: 30000,
  fills: 6,
  balance: 20000,
  createdAt: 'x',
  ...extra,
});

describe('fuel cards and parking cards', () => {
  it('lists fuel cards with their balance, flags the low ones, and never hands on a whole card number', async () => {
    lib.listFuelCards.mockResolvedValue([fuelCard(1), fuelCard(2, { balance: 1200, vehicle: null }), fuelCard(3, { balance: 100, active: false })]);
    const action = await run('list_fuel_cards');
    expect(out(action)).toMatchObject({ total: 3, more: false, currency: 'KES', low: 1, totalBalance: 21200 });
    expect(out(action).cards[0]).toMatchObject({ id: 1, name: 'Shell 01', company: 'Lady Askari', vehicle: 'KDA 111A', balance: 20000, alertBelow: 5000, cardNumber: '…9012', href: '/modules/fuel-cards?card=1' });
    expect(out(action).cards[1]).toMatchObject({ vehicle: 'spare', low: true });
    expect(JSON.stringify(action.result)).not.toContain('7002');
    expect(out(await run('list_fuel_cards', { lowOnly: true })).cards.map((c: { id: number }) => c.id)).toEqual([2]);
  });

  it("reads a fuel card's statement with the balance after each entry", async () => {
    lib.getFuelCardStatement.mockResolvedValue({
      card: fuelCard(1, { loaded: 20000, spent: 9000, balance: 11000 }),
      topUps: [{ id: 1, cardId: 1, kind: 'Top-up', amount: 20000, occurredAt: '2026-11-01T06:00:00.000Z', reference: 'MPESA-1', notes: null, createdBy: null }],
      fills: [{ id: 3, filledAt: '2026-11-10T06:00:00.000Z', vehicle: 'KDA 111A', litres: 50, cost: 9000, station: 'Shell Westlands', filledBy: 'John' }],
    });
    const action = await run('get_fuel_card_statement', { cardId: 1 });
    expect(lib.getFuelCardStatement).toHaveBeenCalledWith(1);
    expect(out(action)).toMatchObject({ card: { id: 1, balance: 11000, low: false }, total: 2, more: false, moneyIn: 20000, moneyOut: 9000, href: '/modules/fuel-cards?card=1' });
    expect(out(action).entries).toEqual([
      { when: '2026-11-10 09:00', kind: 'Fill-up', amount: -9000, balanceAfter: 11000, what: expect.stringContaining('KDA 111A'), detail: 'Shell Westlands · John' },
      { when: '2026-11-01 09:00', kind: 'Top-up', amount: 20000, balanceAfter: 20000, what: 'Top-up', detail: 'MPESA-1' },
    ]);
    // A date window keeps the true running balance.
    expect(out(await run('get_fuel_card_statement', { cardId: 1, from: '2026-11-05' })).entries).toEqual([expect.objectContaining({ balanceAfter: 11000 })]);
  });

  it('says so when a card is not there', async () => {
    lib.getFuelCardStatement.mockResolvedValue(null);
    lib.getParkingStatement.mockResolvedValue(null);
    expect(errorOf(await run('get_fuel_card_statement', { cardId: 8 }))).toContain('Fuel card 8 was not found');
    expect(errorOf(await run('get_parking_card_statement', { cardId: 8 }))).toContain('Parking card 8 was not found');
    expect(errorOf(await run('get_parking_card_statement', {}))).toContain('cardId is required');
  });

  const parkingCard = (id: number, extra: Record<string, unknown> = {}) => ({
    id, name: `KAPS ${id}`, provider: 'KAPS', vehicle: null, cardNumber: null, lowBalanceThreshold: 500, active: true, notes: null, balance: 1500, lastEntryAt: '2026-11-23T10:00:00.000Z', entries: 4, ...extra,
  });

  it('lists parking cards and reads one statement', async () => {
    lib.listParkingCards.mockResolvedValue([parkingCard(1), parkingCard(2, { balance: 200 })]);
    const list = await run('list_parking_cards', { lowOnly: true });
    expect(out(list)).toMatchObject({ total: 1, more: false, low: 1, currency: 'KES' });
    expect(out(list).cards[0]).toMatchObject({ id: 2, balance: 200, low: true, lastUsed: '2026-11-23 13:00', href: '/modules/parking-cards?card=2' });

    lib.getParkingStatement.mockResolvedValue({
      card: parkingCard(1, { balance: 800 }),
      entries: [
        { id: 2, cardId: 1, kind: 'Parking', amount: -200, observedBalance: null, occurredAt: '2026-11-23T10:00:00.000Z', vehicle: { id: 1, registration: 'KDA 111A' }, location: 'JKIA', reference: null, notes: null, createdBy: { id: 7, name: 'Amina' } },
        { id: 1, cardId: 1, kind: 'Top-up', amount: 1000, observedBalance: null, occurredAt: '2026-11-20T10:00:00.000Z', vehicle: null, location: null, reference: null, notes: null, createdBy: null },
      ],
    });
    const statement = await run('get_parking_card_statement', { cardId: 1 });
    expect(lib.getParkingStatement).toHaveBeenCalledWith(1);
    expect(out(statement)).toMatchObject({ total: 2, more: false, toppedUp: 1000, spent: 200 });
    expect(out(statement).entries[0]).toEqual({ when: '2026-11-23 13:00', kind: 'Parking', amount: -200, balanceAfter: 800, vehicle: 'KDA 111A', where: 'JKIA', loggedBy: 'Amina' });
  });

  it('keeps each kind of card behind its own module', () => {
    const fuelOnly = person({ modules: ['car-fuel'] });
    expect(canUseTool(fuelOnly, tool('list_fuel_logs'))).toBe(true);
    expect(canUseTool(fuelOnly, tool('list_fuel_cards'))).toBe(false);
    expect(canUseTool(person({ modules: ['fuel-cards'] }), tool('get_fuel_card_statement'))).toBe(true);
    expect(canUseTool(person({ modules: ['fuel-cards'] }), tool('list_parking_cards'))).toBe(false);
    expect(canUseTool(person({ modules: ['parking-cards'] }), tool('get_parking_card_statement'))).toBe(true);
  });
});

describe('driver licences', () => {
  const licence = (id: number, status: string, daysRemaining: number, extra: Record<string, unknown> = {}) => ({
    id, driverName: `Driver ${id}`, personnelId: id + 50, licenseNumber: `DL-${id}`, category: 'Class B', expiryDate: '2026-12-01T00:00:00.000Z', lastVerified: null, notes: null, status, daysRemaining, hasDocument: false, document: null, createdAt: 'x', ...extra,
  });

  it('lists licences and filters to the expiring or expired', async () => {
    lib.listDriverLicenses.mockResolvedValue([licence(1, 'Expired', -3), licence(2, 'Expiring Soon', 7), licence(3, 'Valid', 200), licence(4, 'Valid', 300)]);
    const action = await run('list_driver_licences', { status: 'Expiring Soon' });
    expect(lib.listDriverLicenses).toHaveBeenCalledWith();
    expect(out(action)).toMatchObject({ total: 1, more: false, expired: 1, expiringSoon: 1 });
    expect(out(action).licences[0]).toEqual({
      id: 2, driver: 'Driver 2', licenceNumber: 'DL-2', class: 'Class B', expires: '2026-12-01', daysLeft: 7, status: 'Expiring Soon', lastVerified: null, href: '/modules/drivers-license-expiry',
    });
    expect(out(await run('list_driver_licences', { q: 'dl-4' })).total).toBe(1);
    expect(errorOf(await run('list_driver_licences', { status: 'expired' }))).toContain('status must be one of');
  });

  it("links to the driver's profile only for someone who can open it", async () => {
    lib.listDriverLicenses.mockResolvedValue([licence(1, 'Valid', 90)]);
    const action = await run('list_driver_licences', {}, context({ modules: ['drivers'] }));
    expect(out(action).licences[0].href).toBe('/modules/drivers?person=51');
  });
});

// --- Travellers, vendors, SOPs ------------------------------------------------------

const traveller = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Traveller ${id}`, email: `t${id}@x.org`, phone: '+254700000000', nationality: 'British', passportExpiry: '2027-03-01T00:00:00.000Z', status: 'Active', riskLevel: 'Standard', hasPhoto: false, customer: { id: 3, name: 'Bridge Corp', company: null }, tripCount: 2, ...extra,
});

describe('travellers', () => {
  it('searches in the database with the filters given', async () => {
    lib.searchTravelers.mockResolvedValue({ items: [traveller(1, { riskLevel: 'High' })], total: 1, page: 1, pageSize: 20 });
    const action = await run('find_travelers', { q: 'doe', risk: 'High', status: 'Active' });
    expect(lib.searchTravelers).toHaveBeenCalledWith({ q: 'doe', risk: 'High', status: 'Active', page: 1, pageSize: 20 });
    expect(out(action)).toMatchObject({ total: 1, page: 1, more: false });
    expect(out(action).travellers[0]).toEqual({
      id: 1, name: 'Traveller 1', client: 'Bridge Corp', nationality: 'British', phone: '+254700000000', email: 't1@x.org', status: 'Active', risk: 'High', passportExpires: '2027-03-01', trips: 2, href: '/modules/travelers?open=1',
    });
  });

  it('gives a count and a hint, not rows, for the whole directory with nothing to narrow it', async () => {
    lib.searchTravelers.mockResolvedValue({ items: many(20, (i) => traveller(i)), total: 340, page: 1, pageSize: 20 });
    const action = await run('find_travelers');
    expect(out(action)).toMatchObject({ total: 340, note: expect.stringContaining('Search by name') });
    expect(out(action).travellers).toBeUndefined();

    // Asked for a page outright, it reads the directory in name order.
    lib.searchTravelers.mockResolvedValue({ items: many(20, (i) => traveller(i)), total: 340, page: 2, pageSize: 20 });
    const second = await run('find_travelers', { page: 2 });
    expect(lib.searchTravelers).toHaveBeenLastCalledWith({ q: null, risk: null, status: null, page: 2, pageSize: 20 });
    expect(out(second)).toMatchObject({ total: 340, page: 2, more: true });
    expect(out(second).travellers).toHaveLength(20);
  });

  it('reads one record without its passport number, birth date, medical notes or emergency contact, and says so when there is none', async () => {
    lib.getTravelerById.mockResolvedValue({
      ...traveller(4), dateOfBirth: '1980-05-06T00:00:00.000Z', passportNumber: 'P123', dietaryNotes: 'Vegetarian', medicalNotes: null, emergencyContactName: 'Sam', emergencyContactPhone: '+44', notes: null, createdAt: 'x',
    });
    const action = await run('get_traveler', { travelerId: 4 });
    expect(lib.getTravelerById).toHaveBeenCalledWith(4);
    expect(out(action)).toMatchObject({ id: 4, dietaryNotes: 'Vegetarian', href: '/modules/travelers?open=4' });
    // A protectee's identifying and medical details stay in the platform: chat is told only that they are on file.
    expect(out(action).onFileButNotShownHere).toEqual(['passport number', 'date of birth', 'emergency contact']);
    expect(JSON.stringify(out(action))).not.toMatch(/P123|1980-05-06|Sam|\+44/);

    lib.getTravelerById.mockResolvedValue(null);
    expect(errorOf(await run('get_traveler', { travelerId: 5 }))).toContain('Traveller 5 was not found');
  });

  it('is only for holders of the Travelers module: trip planners do not get protectee records through chat', () => {
    for (const t of travelerTools) {
      expect(t.requiredModule).toBe('travelers');
      expect(canUseTool(person({ modules: ['trip-planning', 'customers'] }), t)).toBe(false);
      expect(canUseTool(person({ modules: ['travelers'] }), t)).toBe(true);
    }
  });
});

describe('vendors and suppliers', () => {
  const vendor = (id: number, extra: Record<string, unknown> = {}) => ({
    id, name: `Vendor ${id}`, internal: false, status: 'Approved', countries: ['Kenya'], contactName: 'Jo', email: 'jo@v.co', phone: '+2547', notes: null, serviceIds: [10, 11], tripCount: 3, updatedAt: '2026-11-01T00:00:00.000Z', ...extra,
  });
  const register = () => ({
    vendors: [vendor(1, { name: 'Lady Askari', internal: true }), vendor(2), vendor(3, { status: 'Pending', countries: ['Uganda'] })],
    vehicles: [{ id: 1, registration: 'KDA 111A', make: 'Toyota', model: 'Prado', type: 'SUV', vendorId: 2 }, { id: 2, registration: 'KDB 222B', make: null, model: null, type: 'Sedan', vendorId: 1 }],
    people: [{ id: 5, name: 'John', roles: ['Driver'], engagement: 'Contract', status: 'Active', vendorId: 2 }],
  });

  it('reads the register and filters it', async () => {
    lib.getVendorRegister.mockResolvedValue(register());
    const action = await run('find_vendors', { status: 'Approved', externalOnly: true, country: 'kenya' });
    expect(lib.getVendorRegister).toHaveBeenCalledWith();
    expect(out(action)).toMatchObject({ total: 1, more: false, href: '/modules/vendors-suppliers' });
    expect(out(action).vendors[0]).toEqual({ id: 2, name: 'Vendor 2', status: 'Approved', countries: ['Kenya'], contact: 'Jo', phone: '+2547', email: 'jo@v.co', services: 2, vehicles: 1, people: 1, trips: 3 });
    expect(out(await run('find_vendors', { q: 'askari' })).vendors[0]).toMatchObject({ id: 1, internal: true });
  });

  it('opens one vendor with its services, vehicles and people named', async () => {
    lib.getVendorRegister.mockResolvedValue(register());
    lib.listCatalogServices.mockResolvedValue([{ id: 10, name: 'Airport transfer', code: 'AT', category: null, serviceClass: null, country: 'Kenya', unitOfMeasure: null }, { id: 12, name: 'Other', code: null, category: null, serviceClass: null, country: null, unitOfMeasure: null }]);
    const action = await run('get_vendor', { vendorId: 2 });
    expect(out(action)).toMatchObject({
      id: 2, serviceCount: 2, services: [{ id: 10, name: 'Airport transfer', code: 'AT', country: 'Kenya' }], vehicleCount: 1, vehicles: [{ id: 1, registration: 'KDA 111A', model: 'Toyota Prado', type: 'SUV' }], peopleCount: 1, people: [{ id: 5, name: 'John', roles: ['Driver'], status: 'Active' }],
    });
    expect(errorOf(await run('get_vendor', { vendorId: 77 }))).toContain('Vendor 77 was not found');
  });
});

describe('SOPs', () => {
  const sop = (id: number, extra: Record<string, unknown> = {}) => ({
    id, code: `SOP-${id}`, title: `Procedure ${id}`, category: 'Operations', status: 'Active', version: '1.0', ownerName: 'Ops', description: 'How to do it', stepCount: 3, effectiveDate: null, reviewDate: '2026-12-31T00:00:00.000Z', reviewOverdue: false, ackCount: 4, acknowledgedByMe: false, createdAt: 'x', ...extra,
  });

  it('lists procedures for the caller, by category and words', async () => {
    lib.listSops.mockResolvedValue([sop(1, { category: 'Safety', title: 'Evacuation' }), sop(2), sop(3, { acknowledgedByMe: true })]);
    const action = await run('list_sops', { category: 'Safety', q: 'evac' });
    expect(lib.listSops).toHaveBeenCalledWith(7);
    expect(out(action)).toMatchObject({ total: 1, more: false });
    expect(out(action).sops[0]).toEqual({ id: 1, code: 'SOP-1', title: 'Evacuation', category: 'Safety', status: 'Active', version: '1.0', owner: 'Ops', steps: 3, review: '2026-12-31', acknowledgedByUser: false, href: '/modules/sops?open=1' });
    expect(out(await run('list_sops', { notAcknowledged: true })).total).toBe(2);
  });

  it('reads one procedure step by step without acknowledging it', async () => {
    lib.getSop.mockResolvedValue({ ...sop(2), steps: ['Stop', 'Call control', 'Log it'], createdBy: 'Ops', totalUsers: 20, revisions: [{ id: 1, version: '1.0', summary: 'First issue', changedBy: 'Ops', createdAt: '2026-01-05T06:00:00.000Z' }], acknowledgements: [] });
    const action = await run('get_sop', { sopId: 2 });
    expect(lib.getSop).toHaveBeenCalledWith(2, 7);
    expect(out(action)).toMatchObject({ code: 'SOP-2', steps: ['1. Stop', '2. Call control', '3. Log it'], acknowledged: '4 of 20 people (current version)', revisions: [{ version: '1.0', when: '2026-01-05 09:00' }], href: '/modules/sops?open=2' });
    expect(lib.acknowledgeSop).not.toHaveBeenCalled();

    lib.getSop.mockResolvedValue(null);
    expect(errorOf(await run('get_sop', { sopId: 3 }))).toContain('Procedure 3 was not found');
  });
});

// --- Intel, reports, ops dashboard, close-out, task log -----------------------------

describe('intel', () => {
  const assessment = (id: number, extra: Record<string, unknown> = {}) => ({
    id, location: 'Westlands', formattedAddress: 'Westlands, Nairobi', country: 'Kenya', latitude: 1, longitude: 1, title: `Assessment ${id}`, riskLevel: 'Moderate', status: 'Complete', hasMap: true, hasStreet: false, createdAt: '2026-11-20T06:00:00.000Z', createdBy: { id: 2, name: 'Brian' }, ...extra,
  });

  it('lists saved assessments and never runs a new one', async () => {
    lib.listAssessments.mockResolvedValue([assessment(1), assessment(2, { riskLevel: 'High', country: 'Somalia', formattedAddress: 'Mogadishu' })]);
    const action = await run('list_intel_assessments', { risk: 'High' });
    expect(out(action)).toMatchObject({ total: 1, more: false, href: '/modules/intel' });
    expect(out(action).assessments[0]).toEqual({ id: 2, title: 'Assessment 2', place: 'Mogadishu', country: 'Somalia', risk: 'High', by: 'Brian', when: '2026-11-20 09:00' });
    expect(out(await run('list_intel_assessments', { q: 'nairobi' })).total).toBe(1);
    expect(lib.createAssessment).not.toHaveBeenCalled();
    expect(intelTools.map((t) => t.functionDeclaration.name)).toEqual(['list_intel_assessments', 'get_intel_assessment']);
  });

  it('reads one assessment, clipped', async () => {
    lib.getAssessment.mockResolvedValue({ ...assessment(1), context: null, summary: 'Calm.', sections: [{ heading: 'Crime', body: 'x'.repeat(5000) }], recommendations: ['Travel by day'], sources: [{ title: 'News', url: 'https://n.example' }], model: 'm' });
    const action = await run('get_intel_assessment', { assessmentId: 1 });
    expect(lib.getAssessment).toHaveBeenCalledWith(1);
    expect(out(action)).toMatchObject({ id: 1, risk: 'Moderate', summary: 'Calm.', recommendations: ['Travel by day'], sources: [{ title: 'News', url: 'https://n.example' }] });
    expect(out(action).sections[0].text.length).toBeLessThanOrEqual(1501);

    lib.getAssessment.mockResolvedValue(null);
    expect(errorOf(await run('get_intel_assessment', { assessmentId: 2 }))).toContain('Assessment 2 was not found');
  });
});

function report(currency = 'KES') {
  const use = { total: 10, busy: 4, idle: 6 };
  return {
    generatedAt: '2026-11-24T06:00:00.000Z',
    currency,
    fx: { conversions: [{ from: 'USD', to: 'KES', rate: 129.5 }], asOf: '2026-11-24', stale: false, skipped: { invoices: 2, quotes: 0, currencies: ['ZAR'] } },
    finance: {
      totalBilled: 1000, totalCollected: 600, outstanding: 400, overdue: 150, collectedThisMonth: 90, invoiceCount: 12, paidCount: 7,
      statusCounts: { Paid: 7, Sent: 5 }, monthly: many(12, (i) => ({ month: `M${i}`, billed: i, collected: i })), aging: { current: 250, d1_30: 100, d31_60: 50, d61_90: 0, d90plus: 0 },
      topCustomers: many(14, (i) => ({ name: `Client ${i}`, balance: i, overdue: 0 })),
    },
    sales: { totalQuoted: 5000, approvedValue: 2000, conversionRate: 40, quoteCount: 20, statusCounts: { Approved: 8 }, monthly: [], winLoss: { won: 8, lost: 6, open: 6, rate: 40 }, topCustomers: [] },
    operations: { tripStatusCounts: { Active: 3 }, assignmentStatusCounts: {}, activeTrips: 3, totalTrips: 40, fleet: use, drivers: use, officers: use, utilizationPct: 40 },
    compliance: { license: { total: 9, expired: 1, expiringSoon: 2, valid: 6 }, upcoming: [{ name: 'John', licenseNumber: 'DL-1', category: 'Class B', expiry: '2026-12-01T00:00:00.000Z', daysRemaining: 7, status: 'Expiring Soon' }] },
  };
}

describe('reports', () => {
  const rates = { base: 'USD', asOf: '2026-11-24', rates: { KES: 129.5 }, stale: false };

  it('reads the figures the way the Reports page does, and returns the headline only', async () => {
    lib.getRates.mockResolvedValue(rates);
    lib.getReportData.mockResolvedValue(report());
    const action = await run('get_report_figures');
    expect(lib.getReportData).toHaveBeenCalledWith({ userId: 7, currency: 'KES', rates });
    // The organisation's currency is only looked up when there are no rates.
    expect(lib.getOrganizationSettings).not.toHaveBeenCalled();
    expect(out(action)).toMatchObject({
      currency: 'KES',
      asOf: '2026-11-24 09:00',
      finance: { billed: 1000, collected: 600, outstanding: 400, overdue: 150, invoices: 12 },
      sales: { quoted: 5000, approvedValue: 2000, conversionPct: 40, won: 8, lost: 6, open: 6 },
      operations: { activeTrips: 3, trips: 40, utilisationPct: 40 },
      compliance: { driverLicences: { expired: 1, expiringSoon: 2 } },
      exchangeRates: ['1 USD = 129.5 KES'],
      leftOut: expect.stringContaining('2 invoices'),
      href: '/modules/reports?currency=KES',
    });
    // Not the whole payload: no monthly series or client tables until a section is asked for.
    expect(out(action).finance.monthly).toBeUndefined();
    expect(JSON.stringify(action.result)).not.toContain('Client 1');
  });

  it('gives one section in detail, in the currency asked for', async () => {
    lib.getRates.mockResolvedValue(rates);
    lib.getReportData.mockResolvedValue(report('USD'));
    const action = await run('get_report_figures', { currency: 'USD', section: 'finance' });
    expect(lib.getReportData).toHaveBeenCalledWith({ userId: 7, currency: 'USD', rates });
    expect(out(action)).toMatchObject({ currency: 'USD', section: 'finance', finance: { billed: 1000, invoicesByStatus: { Paid: 7, Sent: 5 }, ageing: { d1_30: 100 } } });
    expect(out(action).finance.monthly).toHaveLength(12);
    expect(out(action).finance.topClientsByBalance).toHaveLength(10);
    expect(out(action).sales).toBeUndefined();
  });

  it("stays in the organisation's currency, and says so, when there are no rates at all", async () => {
    lib.getRates.mockResolvedValue(null);
    lib.getOrganizationSettings.mockResolvedValue({ defaultCurrency: 'USD' });
    lib.getReportData.mockResolvedValue({ ...report('USD'), fx: { conversions: [], asOf: null, stale: false, skipped: { invoices: 0, quotes: 0, currencies: [] } } });
    const action = await run('get_report_figures', { currency: 'KES' });
    expect(lib.getReportData).toHaveBeenCalledWith({ userId: 7, currency: 'USD', rates: null });
    expect(out(action)).toMatchObject({ currency: 'USD', note: expect.stringContaining('not KES') });
  });

  it('refuses a currency the page does not report in, and is gated on Reports', async () => {
    expect(errorOf(await run('get_report_figures', { currency: 'EUR' }))).toContain('currency must be one of: KES, USD');
    expect(lib.getReportData).not.toHaveBeenCalled();
    expect(canUseTool(person({ modules: ['invoices-review', 'quotes'] }), tool('get_report_figures'))).toBe(false);
    expect(canUseTool(person({ modules: ['reports'] }), tool('get_report_figures'))).toBe(true);
  });
});

describe('ops dashboard', () => {
  const movement = (id: number, extra: Record<string, unknown> = {}) => ({
    id, tripId: 1589, reference: 'BRG-ZAF-NOV-2668', customer: 'Bridge Corp', country: 'Kenya', category: 'transportation', description: `Transfer ${id}`, timeLabel: 'PICK-UP', scheduledAt: '2026-11-24T06:00:00.000Z', placeName: 'JKIA', crew: 'KDA 111A · John', crewGaps: [], flightNumber: null, completed: false, canEdit: true, ...extra,
  });
  const board = (sections: Record<string, unknown>, allowed = Object.keys(sections)) => ({ generatedAt: '2026-11-24T05:00:00.000Z', allowed, sections, canOpenFlightTracker: false });

  it("hands the lib the whole user, and never asks for WhatsApp, the map or the trackers", async () => {
    lib.loadOpsDashboard.mockResolvedValue(board({ movements: [], vehicles: { total: 12, byStatus: [{ status: 'Available', count: 9 }, { status: 'Maintenance', count: 3 }] } }));
    const as = context({ modules: ['ops-dashboard', 'trip-planning', 'vehicles', 'whatsapp', 'map'] });
    const action = await run('get_ops_dashboard', {}, as);
    const [user, panels] = lib.loadOpsDashboard.mock.calls[0];
    expect(user).toBe(as.user);
    expect(panels).toEqual(['trips', 'movements', 'flights', 'handover', 'tasks', 'maintenance', 'fuel', 'vehicles']);
    expect(out(action)).toMatchObject({ asOf: '2026-11-24 08:00', vehicles: { total: 12, byStatus: { Available: 9, Maintenance: 3 } }, href: '/modules/ops-dashboard' });
    expect(out(action).whatsapp).toBeUndefined();
    expect(out(action).panelsNotAvailableToUser).toEqual(['Active trips', 'Flights', 'Handovers', 'Tasks', 'Car maintenance', 'Car fuel']);
  });

  it('summarises the board: a handful of rows a panel, with the counts', async () => {
    lib.loadOpsDashboard.mockResolvedValue(
      board({
        movements: [movement(1, { completed: true }), ...many(9, (i) => movement(i + 1, i === 1 ? { crew: null, crewGaps: ['driver', 'vehicle', 'CPO'] } : {}))],
        trips: {
          active: 2, startingSoon: 1, escalations: [],
          trips: [{ id: 1589, reference: 'BRG-ZAF-NOV-2668', title: 'T', customer: 'Bridge Corp', status: 'Active', country: 'Kenya', startDate: '2026-11-24T00:00:00.000Z', endDate: null, crew: 'KDA 111A', vehicle: 'KDA 111A', controller: 'Amina', mine: true, canEdit: true, events: [{ id: 1, category: 'transportation', description: 'Airport pickup', timeLabel: null, scheduledAt: '2026-11-24T06:00:00.000Z', placeName: null, crew: null, crewGaps: [], flightNumber: null, completed: false }], lastLog: null }],
        },
      }),
    );
    const action = await run('get_ops_dashboard');
    expect(out(action).movements).toMatchObject({ total: 10, done: 1, withoutFullCrew: 1, nextMore: 4 });
    expect(out(action).movements.next).toHaveLength(5);
    expect(out(action).movements.next[0]).toMatchObject({ eventId: 2, reference: 'BRG-ZAF-NOV-2668', when: '2026-11-24 09:00', what: 'Transfer 2', crewMissing: 'No driver, vehicle or CPO assigned', href: '/modules/trip-planning/1589' });
    expect(out(action).trips).toMatchObject({ active: 2, startingSoon: 1, trips: [{ id: 1589, start: '2026-11-24', next: '2026-11-24 09:00 Airport pickup', href: '/modules/trip-planning/1589' }] });
  });

  it('reads one panel in full when asked', async () => {
    lib.loadOpsDashboard.mockResolvedValue(board({ movements: many(30, (i) => movement(i)) }));
    const action = await run('get_ops_dashboard', { panel: 'movements' });
    expect(lib.loadOpsDashboard.mock.calls[0][1]).toEqual(['movements']);
    expect(out(action).movements.next).toHaveLength(20);
    expect(out(action).movements.nextMore).toBe(10);
  });

  it('says no access for a panel whose module the person does not hold', async () => {
    lib.loadOpsDashboard.mockResolvedValue(board({}, ['trips']));
    const action = await run('get_ops_dashboard', { panel: 'fuel' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('No access to the Car fuel panel');
    expect(errorOf(action)).toContain('Ask IT for permission');
    expect(errorOf(await run('get_ops_dashboard', { panel: 'whatsapp' }))).toContain('panel must be one of');
  });
});

describe('trip close-out', () => {
  const done = (id: number, closeout: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
    id, reference: `BRG-KEN-OCT-${id}`, trackingCode: `LA-${id}`, title: `TASK-${id}`, status: 'Completed', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-04T00:00:00.000Z', customer: { name: 'Bridge Corp', company: null }, travelers: ['J. Doe'], owner: { id: 7, name: 'Amina' }, itemCount: 5, logCount: 2, canOpen: true, closeout, ...extra,
  });

  it('lists the trips still awaiting close-out, with what is outstanding', async () => {
    lib.listCloseoutTrips.mockResolvedValue([
      done(1, null),
      done(2, { checks: ['itinerary', 'crew'], summary: null, issues: 'Late pickup', clientFeedback: null, closedAt: null, closedBy: null, updatedAt: 'x', updatedBy: null }, { canOpen: false }),
      done(3, { checks: [], summary: null, issues: null, clientFeedback: null, closedAt: '2026-10-06T07:00:00.000Z', closedBy: { id: 2, name: 'Brian' }, updatedAt: 'x', updatedBy: null }),
    ]);
    const as = context({ modules: ['trip-closeout'] });
    const action = await run('list_closeout_trips', {}, as);
    expect(lib.listCloseoutTrips).toHaveBeenCalledWith(as.user);
    expect(out(action)).toMatchObject({ total: 2, more: false, awaiting: 2, closed: 1, href: '/modules/trip-planning?tab=close-out' });
    expect(out(action).trips[0]).toMatchObject({ id: 1, reference: 'BRG-KEN-OCT-1', client: 'Bridge Corp', leadTraveller: 'J. Doe', end: '2026-10-04', closeOut: 'not started', href: '/modules/trip-planning/1' });
    expect(out(action).trips[0].checksOutstanding).toHaveLength(6);
    // Started, and not one this person can open the itinerary of.
    expect(out(action).trips[1]).toMatchObject({ closeOut: 'started', issues: 'Late pickup', href: '/modules/trip-planning?tab=close-out' });
    expect(out(action).trips[1].checksOutstanding).toHaveLength(4);

    const closed = out(await run('list_closeout_trips', { state: 'closed' }));
    expect(closed.trips).toEqual([expect.objectContaining({ id: 3, closedOut: '2026-10-06 10:00', closedBy: 'Brian' })]);
    expect(out(await run('list_closeout_trips', { state: 'all', q: 'oct-2' })).total).toBe(1);
  });

  it('is its own grant: planning trips is not enough', () => {
    expect(canUseTool(person({ modules: ['trip-planning'] }), tool('list_closeout_trips'))).toBe(false);
    expect(canUseTool(person({ modules: ['trip-closeout'] }), tool('list_closeout_trips'))).toBe(true);
  });
});

describe('task log', () => {
  const entry = (id: number, state: string, owner: string, extra: Record<string, unknown> = {}) => ({
    id, title: `Task ${id}`, description: null, priority: 'Medium', status: 'To Do', state, dueDate: '2026-11-24T21:00:00.000Z', completed: state === 'Completed', completedAt: state === 'Completed' ? '2026-11-20T07:00:00.000Z' : null, deletedAt: null, createdAt: 'x', updatedAt: '2026-11-20T07:00:00.000Z', owner: { id: 1, name: owner, email: 'x' }, ...extra,
  });

  it("asks the lib for the caller's own entries, and does not name owners to a non-admin", async () => {
    lib.listTaskLogEntries.mockResolvedValue([entry(1, 'Active', 'Amina'), entry(2, 'Completed', 'Amina'), entry(3, 'Deleted', 'Amina')]);
    const action = await run('list_task_log', { state: 'Completed' });
    expect(lib.listTaskLogEntries).toHaveBeenCalledWith({ userId: 7, isAdmin: false });
    expect(out(action)).toMatchObject({ total: 1, more: false, completed: 1, href: '/modules/task-log-entry' });
    // A due date saved at local midnight reads as that local day.
    expect(out(action).entries[0]).toEqual({ id: 2, title: 'Task 2', state: 'Completed', column: 'To Do', priority: 'Medium', due: '2026-11-25', completed: '2026-11-20 10:00', changed: '2026-11-20 10:00' });
    expect(out(action).entries[0].owner).toBeUndefined();
  });

  it("shows an admin everyone's, with the owner, and filters by the day it changed", async () => {
    lib.listTaskLogEntries.mockResolvedValue([entry(1, 'Active', 'Amina'), entry(2, 'Active', 'Brian', { updatedAt: '2026-11-01T07:00:00.000Z' })]);
    const admin = context({ id: 1, roles: ['admin'] });
    const action = await run('list_task_log', { from: '2026-11-10' }, admin);
    expect(lib.listTaskLogEntries).toHaveBeenCalledWith({ userId: 1, isAdmin: true });
    expect(out(action).entries).toEqual([expect.objectContaining({ id: 1, owner: 'Amina' })]);
    expect(out(await run('list_task_log', { q: 'brian' }, admin)).total).toBe(1);
    // A non-admin cannot search by an owner's name: there are no other owners to find.
    expect(out(await run('list_task_log', { q: 'brian' })).total).toBe(0);
  });
});

// --- Flights (a paid outside service) -----------------------------------------------

describe('flight lookup', () => {
  const candidate = (extra: Record<string, unknown> = {}) => ({
    flightNumber: 'KQ100', airline: { name: 'Kenya Airways', iata: 'KQ', icao: 'KQA' },
    origin: { iata: 'NBO', icao: 'HKJK', name: 'JKIA', city: 'Nairobi', country: 'Kenya', tz: 'Africa/Nairobi' },
    destination: { iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London', country: 'United Kingdom', tz: 'Europe/London' },
    departureTime: '09:05', arrivalTime: '15:40', durationMinutes: 575, aircraft: 'B788', registration: '5Y-KZA', runs: 14, lastSeen: '2026-11-23T15:40:00.000Z', airborne: false, basis: 'weekday', onDate: '2026-11-25', dayStatus: 'expected', frequency: 'Daily', departDate: '2026-11-25', arriveDate: '2026-11-25', ...extra,
  });

  it('looks the flight up on the date and at the end asked, spending from the form\'s own budget', async () => {
    lib.lookupFlights.mockResolvedValue({ query: { kind: 'flight', value: 'KQ100' }, date: '2026-11-25', end: 'arrival', candidates: [candidate()], checkedAt: '2026-11-24T06:00:00.000Z' });
    const action = await run('find_flight', { flight: 'KQ 100', date: '2026-11-25', end: 'arrival' });

    // The same scope, key, limit and window as app/api/flight-radar/lookup: one budget, not two.
    expect(lib.enforceRateLimit).toHaveBeenCalledWith({ scope: 'flight.lookup', key: '7', limit: 20, windowMs: 60_000 });
    expect(lib.lookupFlights).toHaveBeenCalledWith('KQ 100', expect.any(Number), '2026-11-25', 'arrival');
    expect(action.ok).toBe(true);
    expect(out(action)).toMatchObject({ query: 'KQ100', date: '2026-11-25', dateIsAt: 'arrival', total: 1, more: false });
    expect(out(action).flights[0]).toMatchObject({
      flight: 'KQ100', airline: 'Kenya Airways',
      from: { code: 'NBO', city: 'Nairobi', timeZone: 'Africa/Nairobi' }, to: { code: 'LHR', city: 'London', timeZone: 'Europe/London' },
      departs: '09:05', departDate: '2026-11-25', arrives: '15:40', durationMinutes: 575, aircraft: 'B788', flies: 'Daily',
      onThatDay: expect.stringContaining('expected'),
    });
  });

  it('defaults to the departure end with no date', async () => {
    lib.lookupFlights.mockResolvedValue({ query: { kind: 'flight', value: 'KQ100' }, date: null, end: 'departure', candidates: [], checkedAt: '2026-11-24T06:00:00.000Z' });
    const action = await run('find_flight', { flight: 'KQ100' });
    expect(lib.lookupFlights).toHaveBeenCalledWith('KQ100', expect.any(Number), null, 'departure');
    expect(out(action)).toMatchObject({ total: 0, note: expect.stringContaining('no recent record of KQ100') });
  });

  it('refuses beyond its cap, and makes no paid call', async () => {
    lib.enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const action = await run('find_flight', { flight: 'KQ100' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('Too many flight lookups');
    expect(errorOf(action)).toContain('42 seconds');
    expect(lib.lookupFlights).not.toHaveBeenCalled();
  });

  it('counts every lookup against the cap, one call each', async () => {
    lib.lookupFlights.mockResolvedValue({ query: { kind: 'flight', value: 'KQ100' }, candidates: [], checkedAt: '2026-11-24T06:00:00.000Z' });
    let used = 0;
    lib.enforceRateLimit.mockImplementation(async ({ limit }: { limit: number }) => ({ allowed: ++used <= limit, remaining: 0, retryAfterSeconds: 30 }));
    const results = [];
    for (let i = 0; i < 22; i += 1) results.push(await run('find_flight', { flight: 'KQ100' }));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(lib.lookupFlights).toHaveBeenCalledTimes(20);
  });

  it('refuses what is not a flight or a date before any paid call', async () => {
    expect(errorOf(await run('find_flight', { flight: 'the morning one' }))).toContain('flight must be a flight number like KQ100');
    expect(errorOf(await run('find_flight', { flight: 'KQ100', date: 'tomorrow' }))).toContain('date must be a real date');
    expect(errorOf(await run('find_flight', { flight: 'KQ100', end: 'landing' }))).toContain('end must be one of');
    expect(errorOf(await run('find_flight', {}))).toContain('flight is required');
    expect(lib.lookupFlights).not.toHaveBeenCalled();
  });

  it("relays the tracker's own refusal instead of failing", async () => {
    lib.lookupFlights.mockRejectedValue(new FlightTrackingError('Flight tracking is not configured.', 503));
    const action = await run('find_flight', { flight: 'KQ100' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toBe('Flight tracking is not configured.');
  });

  it('is open to the modules the lookup route is, and links to the tracker only for those who have it', async () => {
    expect(canUseTool(person({ modules: ['trip-planning'] }), tool('find_flight'))).toBe(true);
    expect(canUseTool(person({ modules: ['flight-tracker'] }), tool('find_flight'))).toBe(true);
    expect(canUseTool(person({ modules: ['calendar'] }), tool('find_flight'))).toBe(false);

    lib.lookupFlights.mockResolvedValue({ query: { kind: 'flight', value: 'KQ100' }, candidates: [candidate()], checkedAt: '2026-11-24T06:00:00.000Z' });
    expect(out(await run('find_flight', { flight: 'KQ100' }, context({ modules: ['trip-planning'] }))).href).toBeUndefined();
    expect(out(await run('find_flight', { flight: 'KQ100' }, context({ modules: ['flight-tracker'] }))).href).toBe('/modules/flight-tracker');
  });
});

// --- Map: tracked devices -----------------------------------------------------------

describe('tracked devices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T09:00:00.000Z'));
    return () => vi.useRealTimers();
  });

  const device = (name: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
    key: `traccar:${name}`, source: 'traccar', name, lat: -1.2920659, lon: 36.8219462, at: Date.parse('2026-11-24T09:00:00.000Z') - minutesAgo * 60_000, ...extra,
  });

  it('lists each tracker with its last known position and how old the fix is', async () => {
    lib.listTrackedDevices.mockResolvedValue({
      devices: [device('KDA 111A', 2, { address: 'Waiyaki Way', speedKph: 42.4, online: true, batteryPct: 88.2 }), device('KDB 222B', 95, { online: false })],
      sources: { traccar: { configured: true, count: 2, error: null }, zello: { configured: true, count: 0, error: 'Zello token expired' } },
    });
    const action = await run('list_tracked_devices');
    expect(lib.listTrackedDevices).toHaveBeenCalledWith();
    expect(out(action)).toMatchObject({ total: 2, more: false, sourceProblems: ['zello: Zello token expired'], href: '/modules/map' });
    expect(out(action).devices[0]).toEqual({ name: 'KDA 111A', source: 'traccar', lat: -1.29207, lon: 36.82195, address: 'Waiyaki Way', lastFix: '2026-11-24 11:58', minutesAgo: 2, speedKph: 42, batteryPct: 88, online: true });
    expect(out(action).devices[1]).toMatchObject({ name: 'KDB 222B', minutesAgo: 95, stale: true, online: false });

    expect(out(await run('list_tracked_devices', { onlineOnly: true })).total).toBe(1);
    expect(out(await run('list_tracked_devices', { q: 'kdb' })).devices.map((d: { name: string }) => d.name)).toEqual(['KDB 222B']);
  });

  it('says when no tracking source is set up, and is gated on the Map module', async () => {
    lib.listTrackedDevices.mockResolvedValue({ devices: [], sources: { traccar: { configured: false, count: 0, error: null }, zello: { configured: false, count: 0, error: null } } });
    expect(out(await run('list_tracked_devices'))).toMatchObject({ total: 0, note: expect.stringContaining('No tracking source') });
    expect(canUseTool(person({ modules: ['vehicles', 'ops-dashboard'] }), tool('list_tracked_devices'))).toBe(false);
    expect(canUseTool(person({ modules: ['map'] }), tool('list_tracked_devices'))).toBe(true);
  });
});

// --- Internal messaging -------------------------------------------------------------

describe('internal messaging', () => {
  const conversation = (id: number, extra: Record<string, unknown> = {}) => ({
    id, type: 'direct', title: null,
    members: [{ id: 7, name: 'Amina', email: 'a@x' }, { id: 2, name: 'Brian', email: 'b@x' }],
    lastMessage: 'See you at the gate', lastMessageAt: '2026-11-24T05:00:00.000Z', unreadCount: 0, updatedAt: 'x', ...extra,
  });

  it("lists the caller's own conversations only", async () => {
    lib.listConversationsForUser.mockResolvedValue([
      conversation(1, { unreadCount: 2 }),
      conversation(2, { type: 'group', title: 'Night desk', members: [{ id: 7, name: 'Amina', email: 'a' }, { id: 3, name: 'Chege', email: 'c' }, { id: 4, name: 'Dana', email: 'd' }] }),
    ]);
    const action = await run('list_my_conversations', {}, context({ id: 7, modules: ['communication'] }));
    expect(lib.listConversationsForUser).toHaveBeenCalledWith(7);
    expect(out(action)).toMatchObject({ total: 2, more: false, unreadConversations: 1, href: '/modules/communication' });
    expect(out(action).conversations).toEqual([
      { conversationId: 1, with: 'Brian', lastMessage: 'See you at the gate', lastMessageAt: '2026-11-24 08:00', unread: 2 },
      { conversationId: 2, with: 'Night desk', type: 'group', members: 3, lastMessage: 'See you at the gate', lastMessageAt: '2026-11-24 08:00', unread: 0 },
    ]);
    expect(out(await run('list_my_conversations', { unreadOnly: true })).total).toBe(1);
    expect(out(await run('list_my_conversations', { q: 'chege' })).conversations[0].conversationId).toBe(2);
  });

  const message = (id: number, senderId: number, senderName: string) => ({
    id, conversationId: 4, senderId, senderName, body: `Message ${id}`, createdAt: `2026-11-24T05:${String(id % 60).padStart(2, '0')}:00.000Z`, readBy: [], recipientCount: 1,
  });

  it('reads the recent messages of a conversation the caller is in, newest first, without marking it read', async () => {
    lib.listMessages.mockResolvedValue(many(25, (i) => message(i, i % 2 ? 7 : 2, i % 2 ? 'Amina' : 'Brian')));
    const action = await run('get_conversation_messages', { conversationId: 4 });
    expect(lib.listMessages).toHaveBeenCalledWith(4, 7);
    expect(out(action)).toMatchObject({ conversationId: 4, total: 25, page: 1, more: true });
    expect(out(action).messages).toHaveLength(20);
    expect(out(action).messages[0]).toEqual({ from: 'the user', when: '2026-11-24 08:25', text: 'Message 25' });
    expect(out(action).messages[1]).toMatchObject({ from: 'Brian', text: 'Message 24' });
    expect(out(action).note).toBeUndefined();
    expect(lib.markConversationRead).not.toHaveBeenCalled();
    expect(lib.sendMessage).not.toHaveBeenCalled();

    expect(out(await run('get_conversation_messages', { conversationId: 4, page: 2 })).messages).toHaveLength(5);
  });

  it("refuses a conversation the caller is not a member of: someone else's is never read", async () => {
    // The lib answers null for a conversation this user does not belong to.
    lib.listMessages.mockResolvedValue(null);
    const action = await run('get_conversation_messages', { conversationId: 99 }, context({ id: 42, modules: ['communication'] }));
    expect(lib.listMessages).toHaveBeenCalledWith(99, 42);
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain("was not found among this user's conversations");
  });

  it('says so when the conversation is longer than the app loads', async () => {
    lib.listMessages.mockResolvedValue(many(200, (i) => message(i, 2, 'Brian')));
    expect(out(await run('get_conversation_messages', { conversationId: 4 })).note).toContain('most recent messages may be missing');
  });

  it('offers nothing that sends, and takes no message text', () => {
    expect(internalMessagingTools.map((t) => t.functionDeclaration.name)).toEqual(['list_my_conversations', 'get_conversation_messages']);
    for (const t of internalMessagingTools) {
      const properties = Object.keys(t.functionDeclaration.parameters.properties ?? {});
      expect(properties.some((key) => /body|text|message|to$/i.test(key))).toBe(false);
    }
    expect(canUseTool(person({ modules: ['whatsapp', 'telegram', 'signal'] }), tool('list_my_conversations'))).toBe(false);
  });
});
