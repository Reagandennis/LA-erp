import 'server-only';

import { REPORT_CURRENCIES } from '@/app/modules/reports/report-currency';
import { API_ACCESS } from '@/lib/api-access';
import { crewGapLabel } from '@/lib/crew-gaps';
import { getRates } from '@/lib/exchange-rates-server';
import { RISK_LEVELS, getAssessment, listAssessments } from '@/lib/intel';
import { type OpsDashboard, type OpsSections, loadOpsDashboard } from '@/lib/ops-dashboard';
import { type OpsPanelKey, PANEL_MODULE, PANEL_TITLE } from '@/lib/ops-panels';
import { getOrganizationSettings } from '@/lib/organization';
import { type ReportData, getReportData } from '@/lib/reports';
import { listTaskLogEntries } from '@/lib/task-log';
import { listCloseoutTrips } from '@/lib/trip-closeout';
import { CLOSEOUT_CHECKS } from '@/lib/trip-closeout-checks';
import { isValidTimeZone, utcToZoned } from '@/lib/zoned-time';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, matches, optDate, optEnum, pageOf, reqId } from './_shared';

/**
 * The read-outs: Intel assessments, the Reports page's figures, the Ops
 * Dashboard, trips awaiting close-out and the task log. Read only. Nothing
 * here generates a new Intel report (that is a paid AI call, made on the page).
 */
const PAGE_SIZE = 20;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);
/** A date-only value, saved at midnight UTC. */
const day10 = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
/** The calendar day an instant falls on for the user. */
const localDay = (iso: string | null, ctx: ToolContext) => (iso ? utcToZoned(iso, ctx.timeZone).date || null : null);

// --- Intel -------------------------------------------------------------------------

const INTEL_HREF = '/modules/intel';

const listIntelTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.intel,
  functionDeclaration: {
    name: 'list_intel_assessments',
    description:
      'Saved Intel location and security assessments, newest first: place, country, risk level, who ran it and when. Search by place; filter by risk. Reading only: a new assessment is run on the Intel page. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Place, address, country or title' },
        risk: { type: 'string', enum: [...RISK_LEVELS] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const risk = optEnum(args, 'risk', RISK_LEVELS);
    const assessments = await listAssessments();
    const wanted = assessments.filter(
      (row) => (!risk || row.riskLevel === risk) && matches(q, row.title, row.location, row.formattedAddress, row.country),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      assessments: rows.map((row) => ({
        id: row.id,
        title: row.title,
        place: row.formattedAddress ?? row.location,
        country: row.country,
        risk: row.riskLevel,
        ...(row.status !== 'Complete' ? { status: row.status } : {}),
        by: row.createdBy?.name ?? null,
        when: localStamp(row.createdAt, ctx.timeZone),
      })),
      href: INTEL_HREF,
    };
  },
};

const SECTIONS_SHOWN = 12;

const getIntelTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.intel,
  functionDeclaration: {
    name: 'get_intel_assessment',
    description: 'Read one saved Intel assessment: risk level, summary, each section, recommendations and sources.',
    parameters: {
      type: 'object',
      properties: { assessmentId: { type: 'integer' } },
      required: ['assessmentId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'assessmentId', 'use list_intel_assessments');
    const row = await getAssessment(id);
    if (!row) throw new ToolRefusal(`Assessment ${id} was not found. Find it with list_intel_assessments.`);
    return {
      id: row.id,
      title: row.title,
      place: row.formattedAddress ?? row.location,
      country: row.country,
      risk: row.riskLevel,
      status: row.status,
      by: row.createdBy?.name ?? null,
      when: localStamp(row.createdAt, ctx.timeZone),
      ...(row.context ? { askedAbout: clip(row.context, 400) } : {}),
      summary: clip(row.summary, 2000),
      sections: row.sections.slice(0, SECTIONS_SHOWN).map((section) => ({ heading: section.heading, text: clip(section.body, 1500) })),
      recommendations: row.recommendations.slice(0, 15).map((line) => clip(line, 400)),
      sources: row.sources.slice(0, 8).map((source) => ({ title: clip(source.title, 100), url: source.url })),
      ...(row.sections.length > SECTIONS_SHOWN ? { note: `Showing ${SECTIONS_SHOWN} of ${row.sections.length} sections; the page has the rest.` } : {}),
      href: INTEL_HREF,
    };
  },
};

export const intelTools: ToolDefinition[] = [listIntelTool, getIntelTool];

// --- Reports -----------------------------------------------------------------------

const REPORT_SECTIONS = ['finance', 'sales', 'operations', 'compliance'] as const;
type ReportSection = (typeof REPORT_SECTIONS)[number];

function reportHeadline(data: ReportData) {
  const { finance, sales, operations, compliance } = data;
  return {
    finance: {
      billed: finance.totalBilled,
      collected: finance.totalCollected,
      outstanding: finance.outstanding,
      overdue: finance.overdue,
      collectedThisMonth: finance.collectedThisMonth,
      invoices: finance.invoiceCount,
      paidInvoices: finance.paidCount,
    },
    sales: {
      quoted: sales.totalQuoted,
      approvedValue: sales.approvedValue,
      conversionPct: sales.conversionRate,
      quotes: sales.quoteCount,
      won: sales.winLoss.won,
      lost: sales.winLoss.lost,
      open: sales.winLoss.open,
    },
    operations: {
      activeTrips: operations.activeTrips,
      trips: operations.totalTrips,
      utilisationPct: operations.utilizationPct,
      vehicles: operations.fleet,
      drivers: operations.drivers,
      officers: operations.officers,
    },
    compliance: { driverLicences: compliance.license },
  };
}

function reportDetail(data: ReportData, section: ReportSection): Record<string, unknown> {
  const headline = reportHeadline(data);
  switch (section) {
    case 'finance':
      return {
        ...headline.finance,
        invoicesByStatus: data.finance.statusCounts,
        // What is owed, by how long it has been due.
        ageing: data.finance.aging,
        monthly: data.finance.monthly,
        topClientsByBalance: data.finance.topCustomers.slice(0, 10),
      };
    case 'sales':
      return {
        ...headline.sales,
        quotesByStatus: data.sales.statusCounts,
        monthly: data.sales.monthly,
        topClientsByQuoted: data.sales.topCustomers.slice(0, 10),
      };
    case 'operations':
      return {
        ...headline.operations,
        tripsByStatus: data.operations.tripStatusCounts,
        assignmentsByStatus: data.operations.assignmentStatusCounts,
      };
    case 'compliance':
      return {
        ...headline.compliance,
        licencesExpiringNext: data.compliance.upcoming.slice(0, 15).map((row) => ({
          driver: row.name,
          licenceNumber: row.licenseNumber,
          class: row.category,
          expires: day10(row.expiry),
          daysLeft: row.daysRemaining,
          status: row.status,
        })),
      };
  }
}

const reportTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  // The Reports page's own grant; it covers the whole organisation.
  requiredModule: 'reports',
  functionDeclaration: {
    name: 'get_report_figures',
    description:
      'The Reports page\'s figures for the whole organisation, money converted to one currency: billed, collected, outstanding, overdue; quoted, approved, conversion; trips and utilisation; licence compliance. Pass `section` for that section\'s monthly figures, status counts, ageing and top clients.',
    parameters: {
      type: 'object',
      properties: {
        currency: { type: 'string', enum: [...REPORT_CURRENCIES], description: `Default ${REPORT_CURRENCIES[0]}` },
        section: { type: 'string', enum: [...REPORT_SECTIONS], description: 'One section in detail' },
      },
    },
  },
  async handler(args, ctx) {
    const requested = optEnum(args, 'currency', REPORT_CURRENCIES);
    const section = optEnum(args, 'section', REPORT_SECTIONS);
    const rates = await getRates();
    // With no rate table at all, the page stays in the organisation's own currency; so does this.
    const currency = rates ? (requested ?? REPORT_CURRENCIES[0]) : (await getOrganizationSettings()).defaultCurrency;
    const data = await getReportData({ userId: ctx.userId, currency, rates });
    const { fx } = data;
    const skipped = fx.skipped.invoices + fx.skipped.quotes;
    return {
      currency: data.currency,
      ...(requested && requested !== data.currency
        ? { note: `No exchange rates are available, so the figures are in ${data.currency}, not ${requested}.` }
        : {}),
      asOf: localStamp(data.generatedAt, ctx.timeZone),
      ...(section ? { section, [section]: reportDetail(data, section) } : reportHeadline(data)),
      ...(fx.conversions.length > 0
        ? { exchangeRates: fx.conversions.map((c) => `1 ${c.from} = ${c.rate} ${c.to}`), ratesFrom: fx.asOf, ...(fx.stale ? { ratesStale: true } : {}) }
        : {}),
      ...(skipped > 0
        ? { leftOut: `${fx.skipped.invoices} invoices and ${fx.skipped.quotes} quotes in ${fx.skipped.currencies.join(', ')} have no rate and are not in the money totals.` }
        : {}),
      ...(section ? {} : { more: 'Pass section (finance, sales, operations, compliance) for monthly figures, status counts and top clients.' }),
      href: `/modules/reports?currency=${data.currency}`,
    };
  },
};

export const reportTools: ToolDefinition[] = [reportTool];

// --- Ops Dashboard -----------------------------------------------------------------

/**
 * The board's panels the assistant reads. WhatsApp is left out on purpose (the
 * assistant does not read outside messaging), and the live map and trackers
 * belong to the Map area's own tool.
 */
const BOARD_PANELS = ['trips', 'movements', 'flights', 'handover', 'tasks', 'maintenance', 'fuel', 'vehicles'] as const satisfies readonly OpsPanelKey[];
type BoardPanel = (typeof BOARD_PANELS)[number];

const tripHref = (id: number) => `/modules/trip-planning/${id}`;

type PanelView = { [K in BoardPanel]: (section: OpsSections[K], limit: number, ctx: ToolContext) => unknown };

const PANEL_VIEW: PanelView = {
  trips: (section, limit, ctx) => ({
    active: section.active,
    startingSoon: section.startingSoon,
    escalations: section.escalations.slice(0, limit).map((e) => ({
      tripId: e.tripId,
      reference: e.reference,
      when: localStamp(e.at, ctx.timeZone),
      detail: clip(e.detail, 160),
      by: e.by,
    })),
    trips: section.trips.slice(0, limit).map((trip) => {
      const next = trip.events.find((event) => !event.completed);
      return {
        id: trip.id,
        reference: trip.reference,
        client: trip.customer,
        status: trip.status,
        country: trip.country,
        start: day10(trip.startDate),
        end: day10(trip.endDate),
        crew: trip.crew,
        controller: trip.controller,
        ...(next ? { next: `${localStamp(next.scheduledAt, ctx.timeZone)} ${next.description}` } : {}),
        ...(trip.lastLog ? { lastLog: `${localStamp(trip.lastLog.at, ctx.timeZone)} ${clip(trip.lastLog.detail, 120)}` } : {}),
        href: tripHref(trip.id),
      };
    }),
    ...(section.trips.length > limit ? { tripsMore: section.trips.length - limit } : {}),
  }),
  movements: (section, limit, ctx) => {
    const open = section.filter((movement) => !movement.completed);
    return {
      total: section.length,
      done: section.length - open.length,
      withoutFullCrew: open.filter((movement) => movement.crewGaps.length > 0).length,
      // What is still to happen, in time order.
      next: open.slice(0, limit).map((movement) => ({
        eventId: movement.id,
        tripId: movement.tripId,
        reference: movement.reference,
        client: movement.customer,
        when: localStamp(movement.scheduledAt, ctx.timeZone),
        ...(movement.timeLabel ? { label: movement.timeLabel } : {}),
        what: movement.description,
        ...(movement.placeName ? { place: movement.placeName } : {}),
        ...(movement.flightNumber ? { flight: movement.flightNumber } : {}),
        crew: movement.crew,
        ...(movement.crewGaps.length > 0 ? { crewMissing: crewGapLabel(movement.crewGaps) } : {}),
        href: tripHref(movement.tripId),
      })),
      ...(open.length > limit ? { nextMore: open.length - limit } : {}),
    };
  },
  flights: (section, limit, ctx) => ({
    total: section.length,
    flights: section.slice(0, limit).map((flight) => {
      // A flight's clock time is its airport's, as on the trip.
      const zone = flight.timezone && isValidTimeZone(flight.timezone) ? flight.timezone : ctx.timeZone;
      return {
        eventId: flight.id,
        tripId: flight.tripId,
        reference: flight.tripReference,
        client: flight.customer,
        flight: flight.flightNumber,
        airline: flight.airline,
        from: flight.from,
        to: flight.to,
        ...(flight.timeLabel ? { label: flight.timeLabel } : {}),
        when: localStamp(flight.scheduledAt, zone),
        ...(zone !== ctx.timeZone ? { timeZone: zone } : {}),
        ...(flight.completed ? { handled: true } : {}),
        href: tripHref(flight.tripId),
      };
    }),
    ...(section.length > limit ? { flightsMore: section.length - limit } : {}),
  }),
  handover: (section, limit) => ({
    awaitingAcknowledgement: section.awaiting,
    handovers: section.items.slice(0, limit).map((item) => ({
      id: item.id,
      shift: `${item.shiftDate.slice(0, 10)} ${item.shiftPeriod}`,
      post: item.post,
      status: item.status,
      summary: clip(item.summary, 200),
      ...(item.watchItems ? { watch: clip(item.watchItems, 160) } : {}),
      author: item.author,
      ...(item.mine ? { writtenByUser: true } : {}),
    })),
    href: '/modules/handover',
  }),
  tasks: (section, limit, ctx) => ({
    open: section.open,
    overdue: section.overdue,
    tasks: section.tasks.slice(0, limit).map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      due: localDay(task.dueDate, ctx),
      ...(task.days !== null ? { daysLeft: task.days } : {}),
      ...(task.shared ? { sharedWithUser: true } : {}),
      href: `/modules/todo-personal?open=${task.id}`,
    })),
  }),
  maintenance: (section, limit) => ({
    overdue: section.overdue,
    dueSoon: section.dueSoon,
    inProgress: section.inProgress,
    jobs: section.jobs.slice(0, limit).map((job) => ({
      id: job.id,
      vehicle: job.vehicle,
      work: job.title,
      category: job.category,
      status: job.display,
      plannedFor: job.scheduledFor,
    })),
    comingDue: section.comingDue.slice(0, limit).map((due) => due.message),
    href: '/modules/car-maintenance',
  }),
  fuel: (section, limit, ctx) => ({
    thisMonth: section.month,
    recent: section.recent.slice(0, limit).map((log) => ({
      vehicle: log.vehicle,
      when: localStamp(log.filledAt, ctx.timeZone),
      litres: log.litres,
      ...(log.cost != null ? { cost: log.cost, currency: log.currency } : {}),
      ...(log.station ? { station: log.station } : {}),
    })),
    href: '/modules/car-fuel',
  }),
  vehicles: (section) => ({ total: section.total, byStatus: Object.fromEntries(section.byStatus.map((row) => [row.status, row.count])) }),
};

function panelView<K extends BoardPanel>(key: K, board: OpsDashboard, limit: number, ctx: ToolContext): unknown {
  const section = board.sections[key];
  return section === undefined ? undefined : PANEL_VIEW[key](section as OpsSections[K], limit, ctx);
}

/** Rows per panel when the whole board is read, and when one panel is. */
const BOARD_ROWS = 5;
const PANEL_ROWS = 20;

const opsBoardTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.opsDashboard,
  functionDeclaration: {
    name: 'get_ops_dashboard',
    description:
      "Today's operational picture from the Ops Dashboard: active trips and escalations, movements from today to a day ahead and their crew gaps, flights, unacknowledged handovers, the user's tasks, maintenance, fuel and vehicle status. Only the panels the user holds modules for. Pass `panel` for one panel in full.",
    parameters: {
      type: 'object',
      properties: {
        panel: { type: 'string', enum: [...BOARD_PANELS], description: 'One panel, up to 20 rows; left out, the top of every panel' },
      },
    },
  },
  async handler(args, ctx) {
    const panel = optEnum(args, 'panel', BOARD_PANELS);
    // The lib decides, panel by panel, what this person may see.
    const board = await loadOpsDashboard(ctx.user, panel ? [panel] : BOARD_PANELS);
    if (panel && !board.allowed.includes(panel)) {
      throw new ToolRefusal(
        `No access to the ${PANEL_TITLE[panel]} panel: it needs the "${PANEL_MODULE[panel]}" module. Ask IT for permission.`,
      );
    }
    const shown = BOARD_PANELS.filter((key) => board.sections[key] !== undefined);
    const limit = panel ? PANEL_ROWS : BOARD_ROWS;
    const hidden = BOARD_PANELS.filter((key) => !board.allowed.includes(key));
    return {
      asOf: localStamp(board.generatedAt, ctx.timeZone),
      timesShownIn: ctx.timeZone,
      ...Object.fromEntries(shown.map((key) => [key, panelView(key, board, limit, ctx)])),
      ...(!panel && hidden.length > 0 ? { panelsNotAvailableToUser: hidden.map((key) => PANEL_TITLE[key]) } : {}),
      ...(!panel ? { more: 'Pass panel for up to 20 rows of one panel.' } : {}),
      href: '/modules/ops-dashboard',
    };
  },
};

export const opsBoardTools: ToolDefinition[] = [opsBoardTool];

// --- Trip Close Out ----------------------------------------------------------------

const CLOSEOUT_STATES = ['awaiting', 'closed', 'all'] as const;
const CLOSEOUT_HREF = '/modules/trip-planning?tab=close-out';

const closeoutTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.tripCloseout,
  functionDeclaration: {
    name: 'list_closeout_trips',
    description:
      'Completed trips on the Close out tab: which still await close-out (and which checks are outstanding) and which are closed. Latest trip first. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: [...CLOSEOUT_STATES], description: 'awaiting (default), closed, or all' },
        q: { type: 'string', description: 'Reference, tracking code, task number, client or traveller' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const state = optEnum(args, 'state', CLOSEOUT_STATES) ?? 'awaiting';
    const q = asString(args.q);
    const trips = await listCloseoutTrips(ctx.user);
    const isClosed = (trip: (typeof trips)[number]) => Boolean(trip.closeout?.closedAt);
    const wanted = trips.filter(
      (trip) =>
        (state === 'all' || (state === 'closed') === isClosed(trip)) &&
        matches(q, trip.reference, trip.trackingCode, trip.title, trip.customer.name, trip.customer.company, ...trip.travelers),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      awaiting: trips.filter((trip) => !isClosed(trip)).length,
      closed: trips.filter(isClosed).length,
      trips: rows.map((trip) => {
        const confirmed = trip.closeout?.checks ?? [];
        const outstanding = CLOSEOUT_CHECKS.filter((check) => !confirmed.includes(check.key)).map((check) => check.label);
        return {
          id: trip.id,
          reference: trip.reference,
          trackingCode: trip.trackingCode,
          taskNumber: trip.title,
          client: trip.customer.company ?? trip.customer.name,
          leadTraveller: trip.travelers[0] ?? null,
          start: day10(trip.startDate),
          end: day10(trip.endDate),
          owner: trip.owner?.name ?? null,
          ...(isClosed(trip)
            ? { closedOut: localStamp(trip.closeout!.closedAt, ctx.timeZone), closedBy: trip.closeout!.closedBy?.name ?? null }
            : { closeOut: trip.closeout ? 'started' : 'not started', checksOutstanding: outstanding }),
          ...(trip.closeout?.issues ? { issues: clip(trip.closeout.issues, 200) } : {}),
          // The itinerary page only where this person may open it.
          href: trip.canOpen ? tripHref(trip.id) : CLOSEOUT_HREF,
        };
      }),
      href: CLOSEOUT_HREF,
    };
  },
};

export const closeoutTools: ToolDefinition[] = [closeoutTool];

// --- Task Log ----------------------------------------------------------------------

const TASK_STATES = ['Active', 'Completed', 'Deleted'] as const;

const taskLogTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: 'task-log-entry',
  functionDeclaration: {
    name: 'list_task_log',
    description:
      "The task log: every personal task as history, completed and deleted ones included, latest change first. The user's own tasks; an admin sees everyone's. Filter by state, words, or the dates it last changed. 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Words in the title or description, or the owner (admins)' },
        state: { type: 'string', enum: [...TASK_STATES] },
        from: { type: 'string', description: 'YYYY-MM-DD: last changed on or after' },
        to: { type: 'string', description: 'YYYY-MM-DD: last changed on or before' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const state = optEnum(args, 'state', TASK_STATES);
    const from = optDate(args, 'from') ?? undefined;
    const to = optDate(args, 'to') ?? undefined;
    if (from && to && to < from) throw new ToolRefusal('to is before from.');
    // The lib narrows to the caller's own tasks unless they are an admin.
    const entries = await listTaskLogEntries({ userId: ctx.userId, isAdmin: ctx.isAdmin });
    const wanted = entries.filter((entry) => {
      if (state && entry.state !== state) return false;
      const changed = localDay(entry.updatedAt, ctx);
      if ((from || to) && (!changed || (from && changed < from) || (to && changed > to))) return false;
      return matches(q, entry.title, entry.description, ctx.isAdmin ? entry.owner.name : null);
    });
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    const count = (name: (typeof TASK_STATES)[number]) => wanted.filter((entry) => entry.state === name).length;
    return {
      total,
      page,
      more,
      active: count('Active'),
      completed: count('Completed'),
      deleted: count('Deleted'),
      entries: rows.map((entry) => ({
        id: entry.id,
        title: entry.title,
        state: entry.state,
        column: entry.status,
        priority: entry.priority,
        due: localDay(entry.dueDate, ctx),
        ...(entry.completedAt ? { completed: localStamp(entry.completedAt, ctx.timeZone) } : {}),
        ...(entry.deletedAt ? { deleted: localStamp(entry.deletedAt, ctx.timeZone) } : {}),
        changed: localStamp(entry.updatedAt, ctx.timeZone),
        ...(ctx.isAdmin ? { owner: entry.owner.name } : {}),
        ...(entry.description ? { description: clip(entry.description, 160) } : {}),
      })),
      timesShownIn: ctx.timeZone,
      href: '/modules/task-log-entry',
    };
  },
};

export const taskLogTools: ToolDefinition[] = [taskLogTool];
