import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import OpsDashboardClient from '../app/modules/ops-dashboard/ops-dashboard-client';
import { Panel } from '../app/modules/ops-dashboard/ops-ui';
import type { OpsDashboard } from '../lib/ops-dashboard';

const at = '2026-10-27T09:00:00.000Z';

const board: OpsDashboard = {
  generatedAt: at,
  allowed: ['movements', 'trips', 'flights', 'whatsapp', 'handover', 'tasks', 'maintenance', 'fuel'],
  canOpenFlightTracker: true,
  sections: {
    movements: [
      { id: 1, tripId: 11, reference: 'MCF-KEN-OCT-2661', customer: 'MCF', country: 'Kenya', category: 'transportation', description: 'Airport pickup', timeLabel: 'PICK-UP', scheduledAt: at, placeName: 'JKIA', crew: 'KDA 123A · Peter', flightNumber: null, completed: false, canEdit: true },
      { id: 2, tripId: 11, reference: 'MCF-KEN-OCT-2661', customer: 'MCF', country: 'Kenya', category: 'flight', description: 'Arrival', timeLabel: 'ARRIVAL', scheduledAt: at, placeName: null, crew: null, flightNumber: 'KQ 101', completed: true, canEdit: true },
    ],
    trips: {
      active: 1,
      startingSoon: 0,
      escalations: [{ id: 4, tripId: 11, reference: 'MCF-KEN-OCT-2661', country: 'Kenya', detail: 'Road closed', at, by: 'Ops' }],
      trips: [
        { id: 11, reference: 'MCF-KEN-OCT-2661', title: 'Nairobi visit', customer: 'MCF', status: 'Active', country: 'Kenya', startDate: at, endDate: null, crew: 'KDA 123A', controller: 'Ops', mine: true, canEdit: true, events: [{ id: 1, category: 'transportation', description: 'Airport pickup', timeLabel: null, scheduledAt: at, placeName: 'JKIA', crew: null, flightNumber: null, completed: false }], lastLog: { at, detail: 'At hotel', escalated: true, by: 'Ops' } },
      ],
    },
    flights: [
      { id: 2, tripId: 11, tripReference: 'MCF-KEN-OCT-2661', tripTitle: 'Nairobi visit', customer: 'MCF', country: 'Kenya', timeLabel: 'ARRIVAL', scheduledAt: at, endsAt: null, durationMinutes: 480, airline: 'Kenya Airways', flightNumber: 'KQ 101', from: 'LHR', to: 'NBO', timezone: 'Africa/Nairobi', completed: false, canEdit: true },
    ],
    whatsapp: { linked: true, unreadChats: 1, chats: [{ accountId: 3, chatId: 'a', name: 'Driver Peter', kind: 'dm', lastMessageAt: at, unread: 2, preview: { text: 'At the gate', fromMe: false, senderName: 'Peter', mediaKind: null } }] },
    handover: { awaiting: 1, items: [{ id: 1, shiftDate: at, shiftPeriod: 'Night', post: 'Desk', status: 'Urgent', summary: 'Busy night', watchItems: 'KQ 101', author: 'Lead', createdAt: at, mine: false }] },
    tasks: { open: 1, overdue: 1, tasks: [{ id: 1, title: 'Call the hotel', priority: 'high', status: 'Backlog', dueDate: at, days: -1, shared: false }] },
    maintenance: { overdue: 1, dueSoon: 0, inProgress: 0, jobs: [{ id: 1, vehicle: 'KDA 123A', kind: 'Scheduled', category: 'Service', title: 'Service', status: 'Planned', display: 'Overdue', scheduledFor: '2026-10-20' }], comingDue: [{ key: 'k', maintenanceId: 2, message: 'Service for KDA 123A is due', overdue: false }] },
    fuel: { month: { fills: 1, litres: 60, spend: { KES: 12000 } }, recent: [{ id: 1, vehicle: 'KDA 123A', filledAt: at, litres: 60, cost: 12000, currency: 'KES', station: 'Total' }] },
  },
};

describe('the Ops Dashboard page', () => {
  it('renders every panel on the server', () => {
    const html = renderToString(
      createElement(OpsDashboardClient, { initial: board, reference: { vehicles: [{ id: 1, registration: 'KDA 123A', make: null, model: null }], defaultCurrency: 'KES' } }),
    );
    for (const text of ['Movements', 'Trip board', 'Flights', 'WhatsApp', 'Shift handover', 'Tasks', 'Car maintenance', 'Car fuel', 'Airport pickup', 'Busy night', 'Call the hotel', 'Driver Peter']) {
      expect(html).toContain(text);
    }
  });

  it('says so when the viewer holds none of the panels’ modules', () => {
    const html = renderToString(createElement(OpsDashboardClient, { initial: { ...board, allowed: [], sections: {} }, reference: null }));
    expect(html).toContain('Nothing to show yet');
  });
});

describe('a resized panel', () => {
  it('spans the columns and holds the height it was given', () => {
    const frame = { collapsed: false, loading: false, onToggleCollapse: () => {}, size: { cols: 3 as const, height: 300 }, onResize: () => {} };
    const html = renderToString(
      <Panel id="p" icon="trip-planning" title="Trips" href="/x" moduleName="X" frame={frame}>
        body
      </Panel>,
    );
    expect(html).toContain('2xl:col-span-3');
    expect(html).toContain('height:300px');
    expect(html).toContain('Drag to resize');
  });
});
