'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AccountStatus, CustomerAccount } from '@/lib/accounts';
import type {
  ActivityType,
  ContractOption,
  CrmActivitySummary,
  CrmContact,
  CrmCustomer,
  DealStage,
  DealSummary,
  QuoteOption,
  SignatureStatus,
} from '@/lib/crm';

// --- Config mirrored from lib/crm.ts (server-only module; types import fine, values don't) ---

const ENTITIES = ['LADYASKARI LIMITED', 'LIONESS ALLIANCE', 'STARLLWART'] as const;
type Entity = (typeof ENTITIES)[number];

const ENTITY_STYLES: Record<string, { badge: string; dot: string }> = {
  LADYASKARI: { badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  LIONESS: { badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  STARLLWART: { badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
};

const STAGES: Array<{ key: DealStage; label: string }> = [
  { key: 'lead', label: 'Lead' },
  { key: 'onboarding', label: 'Contract / NDA' },
  { key: 'proposal', label: 'Quote / Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'execution', label: 'Execution' },
  { key: 'invoiced', label: 'Invoice Submitted' },
  { key: 'closed', label: 'Received / Closed' },
  { key: 'lost', label: 'Lost' },
];

const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<DealStage, string>;

type BoardColumn = {
  key: string;
  label: string;
  stage: DealStage | null;
  virtual?: boolean;
  dot: string;
  well?: string;
  dim?: boolean;
};

// "Outstanding 30+ d" is a derived bucket for invoiced deals past 30 days.
const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'lead', label: 'Lead', stage: 'lead', dot: 'bg-gray-400' },
  { key: 'onboarding', label: 'Contract / NDA', stage: 'onboarding', dot: 'bg-sky-500' },
  { key: 'proposal', label: 'Quote / Proposal', stage: 'proposal', dot: 'bg-blue-600' },
  { key: 'won', label: 'Won', stage: 'won', dot: 'bg-emerald-500' },
  { key: 'execution', label: 'Execution', stage: 'execution', dot: 'bg-teal-500' },
  { key: 'invoiced', label: 'Invoice Submitted', stage: 'invoiced', dot: 'bg-indigo-500' },
  { key: 'closed', label: 'Received / Closed', stage: 'closed', dot: 'bg-emerald-600' },
  {
    key: 'outstanding',
    label: 'Outstanding 30+ d',
    stage: null,
    virtual: true,
    dot: 'bg-rose-500',
    well: 'bg-rose-50/70',
  },
  { key: 'lost', label: 'Lost', stage: 'lost', dot: 'bg-gray-300', dim: true },
];

const SIGNATURE_LABELS: Record<SignatureStatus, string> = {
  none: 'No signature',
  sent: 'Sent for signature',
  signed: 'Signed',
  declined: 'Declined',
};

const SIGNATURE_STYLES: Record<string, string> = {
  sent: 'bg-blue-50 text-blue-700',
  signed: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-rose-50 text-rose-700',
};

const ACTIVITY_OPTIONS: Array<{ key: ActivityType; label: string; icon: string }> = [
  { key: 'call', label: 'Call', icon: '📞' },
  { key: 'email', label: 'Email', icon: '✉️' },
  { key: 'meeting', label: 'Meeting', icon: '🤝' },
  { key: 'note', label: 'Note', icon: '📝' },
];

const ACTIVITY_META = Object.fromEntries(ACTIVITY_OPTIONS.map((o) => [o.key, o])) as Record<
  ActivityType,
  { key: ActivityType; label: string; icon: string }
>;

const STATUS_STYLES: Record<string, string> = {
  Overdue: 'bg-rose-50 text-rose-700',
  Open: 'bg-blue-50 text-blue-700',
  Settled: 'bg-emerald-50 text-emerald-700',
  New: 'bg-gray-100 text-gray-600',
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Sent: 'bg-blue-50 text-blue-700',
  Partial: 'bg-amber-50 text-amber-700',
  Paid: 'bg-emerald-50 text-emerald-700',
  Void: 'bg-gray-100 text-gray-400',
  Overdue: 'bg-rose-50 text-rose-700',
};

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400';

// --- Helpers ---

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
}

function formatCompactMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function entityStyle(entity: string) {
  return ENTITY_STYLES[entity] ?? ENTITY_STYLES.LADYASKARI;
}

// --- Props ---

interface CustomersClientProps {
  currency: string;
  initialAccounts: CustomerAccount[];
  initialDeals: DealSummary[];
  initialCustomers: CrmCustomer[];
  initialActivities: CrmActivitySummary[];
  quoteOptions: QuoteOption[];
  contractOptions: ContractOption[];
}

type Tab = 'pipeline' | 'accounts' | 'receivables';

export default function CustomersClient({
  currency,
  initialAccounts,
  initialDeals,
  initialCustomers,
  initialActivities,
  quoteOptions,
  contractOptions,
}: CustomersClientProps) {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [entityFilter, setEntityFilter] = useState<'All' | Entity>('All');

  const [accounts, setAccounts] = useState<CustomerAccount[]>(initialAccounts);
  const [deals, setDeals] = useState<DealSummary[]>(initialDeals);
  const [customers, setCustomers] = useState<CrmCustomer[]>(initialCustomers);
  const [activities, setActivities] = useState<CrmActivitySummary[]>(initialActivities);

  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const entityByCustomerId = useMemo(
    () => new Map(customers.map((c) => [c.id, c.entity])),
    [customers],
  );

  const matchesEntity = (customerId: number) =>
    entityFilter === 'All' || entityByCustomerId.get(customerId) === entityFilter;

  const visibleDeals = useMemo(
    () => deals.filter((deal) => matchesEntity(deal.customer.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, entityFilter, entityByCustomerId],
  );

  const selectedDeal = selectedDealId === null ? null : deals.find((d) => d.id === selectedDealId) ?? null;
  const selectedCustomer =
    selectedCustomerId === null ? null : customers.find((c) => c.id === selectedCustomerId) ?? null;
  const selectedAccount =
    selectedAccountId === null ? null : accounts.find((a) => a.id === selectedAccountId) ?? null;

  // --- Mutations ---

  const upsertDeal = (deal: DealSummary) =>
    setDeals((current) => {
      const exists = current.some((d) => d.id === deal.id);
      return exists ? current.map((d) => (d.id === deal.id ? deal : d)) : [deal, ...current];
    });

  const patchDeal = async (dealId: number, patch: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as { deal?: DealSummary; error?: string } | null;
      if (!res.ok || !data?.deal) return data?.error ?? 'Could not update deal';
      upsertDeal(data.deal);
      return null;
    } catch {
      return 'Network error. Try again.';
    }
  };

  const moveDeal = async (dealId: number, stage: DealStage) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === stage) return;
    // Optimistic move; server response corrects stageChangedAt/isOutstanding.
    setDeals((current) =>
      current.map((d) =>
        d.id === dealId
          ? { ...d, stage, stageChangedAt: new Date().toISOString(), daysInStage: 0, isOutstanding: false }
          : d,
      ),
    );
    await patchDeal(dealId, { stage });
  };

  const deleteDeal = async (dealId: number) => {
    if (!window.confirm('Delete this deal? This cannot be undone.')) return;
    const res = await fetch(`/api/crm/deals/${dealId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      setDeals((current) => current.filter((d) => d.id !== dealId));
      setSelectedDealId(null);
    }
  };

  const addActivity = async (input: {
    customerId: number;
    dealId?: number | null;
    contactId?: number | null;
    type: ActivityType;
    summary: string;
  }): Promise<string | null> => {
    try {
      const res = await fetch('/api/crm/activities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as
        | { activity?: CrmActivitySummary; error?: string }
        | null;
      if (!res.ok || !data?.activity) return data?.error ?? 'Could not log activity';
      setActivities((current) => [data.activity!, ...current]);
      return null;
    } catch {
      return 'Network error. Try again.';
    }
  };

  const saveCustomer = async (
    customerId: number,
    patch: Record<string, unknown>,
  ): Promise<string | null> => {
    try {
      const res = await fetch(`/api/crm/customers/${customerId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as { customer?: CrmCustomer; error?: string } | null;
      if (!res.ok || !data?.customer) return data?.error ?? 'Could not save customer';
      setCustomers((current) => current.map((c) => (c.id === customerId ? data.customer! : c)));
      // Keep names in sync on deals and receivables.
      setDeals((current) =>
        current.map((d) =>
          d.customer.id === customerId
            ? { ...d, customer: { id: customerId, name: data.customer!.name, entity: data.customer!.entity } }
            : d,
        ),
      );
      setAccounts((current) =>
        current.map((a) => (a.id === customerId ? { ...a, name: data.customer!.name } : a)),
      );
      return null;
    } catch {
      return 'Network error. Try again.';
    }
  };

  const addContact = async (
    customerId: number,
    draft: { name: string; role: string; email: string; phone: string },
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          role: draft.role.trim() || null,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          category: 'Client',
          customerId,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { item?: { id: number; name: string; role: string | null; email: string | null; phone: string | null }; error?: string }
        | null;
      if (!res.ok || !data?.item) return data?.error ?? 'Could not add contact';
      const contact: CrmContact = {
        id: data.item.id,
        name: data.item.name,
        role: data.item.role,
        email: data.item.email,
        phone: data.item.phone,
      };
      setCustomers((current) =>
        current.map((c) => (c.id === customerId ? { ...c, contacts: [...c.contacts, contact] } : c)),
      );
      return null;
    } catch {
      return 'Network error. Try again.';
    }
  };

  // --- Render ---

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Customers</h1>
            <p className="mt-1 text-sm text-gray-500">
              Pipeline, account profiles, and receivables across all entities.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['All', ...ENTITIES] as const).map((entity) => (
              <button
                key={entity}
                type="button"
                onClick={() => setEntityFilter(entity)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  entityFilter === entity
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {entity === 'All' ? 'All entities' : entity}
              </button>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-gray-200 sm:block" />
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              New customer
            </button>
            <button
              type="button"
              onClick={() => setShowNewDeal(true)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              + New deal
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-2xl border border-gray-100 bg-white p-1.5">
          {(
            [
              { key: 'pipeline', label: 'Pipeline' },
              { key: 'accounts', label: 'Accounts' },
              { key: 'receivables', label: 'Receivables' },
            ] as Array<{ key: Tab; label: string }>
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none ${
                tab === t.key ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'pipeline' && (
          <PipelineBoard
            deals={visibleDeals}
            currency={currency}
            dragOverColumn={dragOverColumn}
            setDragOverColumn={setDragOverColumn}
            onMove={moveDeal}
            onOpen={setSelectedDealId}
          />
        )}

        {tab === 'accounts' && (
          <AccountsList
            customers={customers.filter((c) => entityFilter === 'All' || c.entity === entityFilter)}
            accounts={accounts}
            deals={deals}
            onOpen={setSelectedCustomerId}
          />
        )}

        {tab === 'receivables' && (
          <ReceivablesView
            accounts={accounts.filter((a) => matchesEntity(a.id))}
            currency={currency}
            onOpen={setSelectedAccountId}
          />
        )}
      </div>

      {selectedDeal && (
        <DealDrawer
          deal={selectedDeal}
          activities={activities.filter((a) => a.dealId === selectedDeal.id)}
          quoteOptions={quoteOptions.filter(
            (q) => q.customerId === selectedDeal.customer.id,
          )}
          contractOptions={contractOptions}
          contacts={customers.find((c) => c.id === selectedDeal.customer.id)?.contacts ?? []}
          onClose={() => setSelectedDealId(null)}
          onSave={(patch) => patchDeal(selectedDeal.id, patch)}
          onDelete={() => deleteDeal(selectedDeal.id)}
          onAddActivity={addActivity}
          onOpenCustomer={() => {
            setSelectedDealId(null);
            setSelectedCustomerId(selectedDeal.customer.id);
            setTab('accounts');
          }}
        />
      )}

      {selectedCustomer && !selectedDeal && (
        <CustomerDrawer
          customer={selectedCustomer}
          account={accounts.find((a) => a.id === selectedCustomer.id) ?? null}
          deals={deals.filter((d) => d.customer.id === selectedCustomer.id)}
          activities={activities.filter((a) => a.customerId === selectedCustomer.id)}
          onClose={() => setSelectedCustomerId(null)}
          onSave={(patch) => saveCustomer(selectedCustomer.id, patch)}
          onAddContact={(draft) => addContact(selectedCustomer.id, draft)}
          onAddActivity={addActivity}
          onOpenDeal={(dealId) => {
            setSelectedCustomerId(null);
            setSelectedDealId(dealId);
          }}
        />
      )}

      {selectedAccount && !selectedCustomer && !selectedDeal && (
        <ReceivablesDrawer account={selectedAccount} onClose={() => setSelectedAccountId(null)} />
      )}

      {showNewDeal && (
        <NewDealModal
          customers={customers}
          quoteOptions={quoteOptions}
          currency={currency}
          onClose={() => setShowNewDeal(false)}
          onCreated={(deal) => {
            upsertDeal(deal);
            setShowNewDeal(false);
            setTab('pipeline');
          }}
        />
      )}

      {showNewCustomer && (
        <NewCustomerModal
          currency={currency}
          onClose={() => setShowNewCustomer(false)}
          onCreated={(customer, account) => {
            setCustomers((current) =>
              [...current, customer].sort((a, b) => a.name.localeCompare(b.name)),
            );
            setAccounts((current) => [account, ...current.filter((a) => a.id !== account.id)]);
            setShowNewCustomer(false);
            setSelectedCustomerId(customer.id);
            setTab('accounts');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function PipelineBoard({
  deals,
  currency,
  dragOverColumn,
  setDragOverColumn,
  onMove,
  onOpen,
}: {
  deals: DealSummary[];
  currency: string;
  dragOverColumn: string | null;
  setDragOverColumn: (key: string | null) => void;
  onMove: (dealId: number, stage: DealStage) => void;
  onOpen: (dealId: number) => void;
}) {
  const columns = BOARD_COLUMNS.map((column) => {
    const columnDeals = deals.filter((deal) =>
      column.virtual
        ? deal.isOutstanding
        : column.stage === 'invoiced'
          ? deal.stage === 'invoiced' && !deal.isOutstanding
          : deal.stage === column.stage,
    );
    return { ...column, deals: columnDeals, total: columnDeals.reduce((acc, d) => acc + d.value, 0) };
  });

  const openValue = deals
    .filter((d) => ['lead', 'onboarding', 'proposal'].includes(d.stage))
    .reduce((acc, d) => acc + d.value, 0);
  const deliveryValue = deals
    .filter((d) => ['won', 'execution'].includes(d.stage))
    .reduce((acc, d) => acc + d.value, 0);
  const awaitingValue = deals.filter((d) => d.stage === 'invoiced').reduce((acc, d) => acc + d.value, 0);
  const outstandingValue = deals.filter((d) => d.isOutstanding).reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <SummaryCard label="Open pipeline" value={formatCompactMoney(openValue, currency)} accent="text-primary" />
        <SummaryCard label="In delivery" value={formatCompactMoney(deliveryValue, currency)} accent="text-teal-600" />
        <SummaryCard label="Awaiting payment" value={formatCompactMoney(awaitingValue, currency)} />
        <SummaryCard
          label="Outstanding 30+ days"
          value={formatCompactMoney(outstandingValue, currency)}
          accent={outstandingValue > 0 ? 'text-rose-600' : 'text-gray-900'}
        />
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex items-start gap-3">
          {columns.map((column) => {
            const isDropTarget = dragOverColumn === column.key && !column.virtual;
            return (
              <div
                key={column.key}
                onDragOver={(e) => {
                  if (column.virtual) return;
                  e.preventDefault();
                  setDragOverColumn(column.key);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => {
                  setDragOverColumn(null);
                  if (column.virtual || !column.stage) return;
                  e.preventDefault();
                  const dealId = Number(e.dataTransfer.getData('text/deal-id'));
                  if (dealId) onMove(dealId, column.stage);
                }}
                className={`flex w-[17rem] shrink-0 flex-col rounded-2xl p-1.5 transition-colors ${
                  isDropTarget ? 'bg-primary/10 ring-2 ring-primary/30' : column.well ?? 'bg-gray-200/50'
                } ${column.dim ? 'opacity-75' : ''}`}
              >
                <div className="flex items-center gap-2 px-2 pb-2 pt-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${column.dot}`} />
                  <p className="min-w-0 truncate text-[13px] font-semibold text-gray-700">{column.label}</p>
                  <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-500 shadow-sm">
                    {column.deals.length}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] font-medium text-gray-400">
                    {column.total > 0 ? formatCompactMoney(column.total, currency) : ''}
                  </span>
                  {column.virtual && (
                    <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-600">
                      auto
                    </span>
                  )}
                </div>
                <div className="max-h-[65vh] min-h-[9rem] space-y-2 overflow-y-auto rounded-xl p-0.5">
                  {column.deals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} onOpen={() => onOpen(deal.id)} />
                  ))}
                  {column.deals.length === 0 && (
                    <div
                      className={`flex h-24 items-center justify-center rounded-xl border-2 border-dashed text-xs font-medium ${
                        isDropTarget ? 'border-primary/40 text-primary' : 'border-gray-300/60 text-gray-400'
                      }`}
                    >
                      {isDropTarget ? 'Drop here' : column.virtual ? 'Nothing overdue' : 'No deals'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Drag deals between stages. Invoiced deals unpaid for 30+ days move to “Outstanding” automatically — record the
        payment or drag the deal to “Received / Closed” to clear it.
      </p>
    </div>
  );
}

function DealCard({ deal, onOpen }: { deal: DealSummary; onOpen: () => void }) {
  const style = entityStyle(deal.customer.entity);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', String(deal.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpen}
      className="group cursor-grab select-none rounded-xl border border-gray-200/70 bg-white p-3.5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:cursor-grabbing"
    >
      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900 group-hover:text-primary">
        {deal.title}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${style.dot}`}
          title={deal.customer.entity}
        >
          {initials(deal.customer.name)}
        </span>
        <p className="truncate text-xs text-gray-500">{deal.customer.name}</p>
      </div>

      {(deal.quote || deal.signatureStatus !== 'none' || deal.isOutstanding) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {deal.quote && (
            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {deal.quote.reference}
            </span>
          )}
          {deal.signatureStatus !== 'none' && (
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${SIGNATURE_STYLES[deal.signatureStatus]}`}>
              ✍ {deal.signatureStatus}
            </span>
          )}
          {deal.isOutstanding && (
            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
              {deal.daysInStage}d overdue
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2">
        <span className="text-[13px] font-bold text-gray-900">
          {deal.value > 0 ? formatCompactMoney(deal.value, deal.currency) : '—'}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {deal.daysInStage === 0 ? 'today' : `${deal.daysInStage}d`}
          {deal.expectedCloseDate && <span className="text-gray-300">·</span>}
          {deal.expectedCloseDate && formatDate(deal.expectedCloseDate)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal drawer
// ---------------------------------------------------------------------------

function DealDrawer({
  deal,
  activities,
  quoteOptions,
  contractOptions,
  contacts,
  onClose,
  onSave,
  onDelete,
  onAddActivity,
  onOpenCustomer,
}: {
  deal: DealSummary;
  activities: CrmActivitySummary[];
  quoteOptions: QuoteOption[];
  contractOptions: ContractOption[];
  contacts: CrmContact[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<string | null>;
  onDelete: () => void;
  onAddActivity: (input: {
    customerId: number;
    dealId?: number | null;
    contactId?: number | null;
    type: ActivityType;
    summary: string;
  }) => Promise<string | null>;
  onOpenCustomer: () => void;
}) {
  const [draft, setDraft] = useState({
    title: deal.title,
    stage: deal.stage as string,
    value: String(deal.value || ''),
    quoteId: deal.quote?.id ?? 0,
    contractId: deal.contract?.id ?? 0,
    signatureStatus: deal.signatureStatus as string,
    expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
    lostReason: deal.lostReason ?? '',
    notes: deal.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      title: deal.title,
      stage: deal.stage,
      value: String(deal.value || ''),
      quoteId: deal.quote?.id ?? 0,
      contractId: deal.contract?.id ?? 0,
      signatureStatus: deal.signatureStatus,
      expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
      lostReason: deal.lostReason ?? '',
      notes: deal.notes ?? '',
    });
    setError(null);
  }, [deal]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const message = await onSave({
      title: draft.title,
      stage: draft.stage,
      value: Number(draft.value) || 0,
      quoteId: draft.quoteId || null,
      contractId: draft.contractId || null,
      signatureStatus: draft.signatureStatus,
      expectedCloseDate: draft.expectedCloseDate || null,
      lostReason: draft.lostReason || null,
      notes: draft.notes || null,
    });
    setSaving(false);
    if (message) setError(message);
  };

  const style = entityStyle(deal.customer.entity);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-xl">
        <div className="bg-primary px-6 py-6 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Deal</p>
              <h2 className="truncate text-xl font-bold">{deal.title}</h2>
              <button type="button" onClick={onOpenCustomer} className="mt-1 flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                {deal.customer.name} · {deal.customer.entity} →
              </button>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
              {STAGE_LABELS[deal.stage]}
              {deal.isOutstanding && ' · Outstanding'}
            </span>
            <p className="text-xl font-bold">{formatMoney(deal.value, deal.currency)}</p>
          </div>
        </div>

        <div className="flex-1 space-y-6 px-6 py-6">
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Title</label>
              <input type="text" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Stage</label>
                <select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} className={inputClass}>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Value ({deal.currency})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.value}
                  onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Linked quote</label>
                <select
                  value={draft.quoteId}
                  onChange={(e) => setDraft((d) => ({ ...d, quoteId: Number(e.target.value) }))}
                  className={inputClass}
                >
                  <option value={0}>None</option>
                  {quoteOptions.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.reference} · {q.status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Linked contract / NDA</label>
                <select
                  value={draft.contractId}
                  onChange={(e) => setDraft((d) => ({ ...d, contractId: Number(e.target.value) }))}
                  className={inputClass}
                >
                  <option value={0}>None</option>
                  {contractOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.reference} · {c.counterpartyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>E-signature</label>
                <select
                  value={draft.signatureStatus}
                  onChange={(e) => setDraft((d) => ({ ...d, signatureStatus: e.target.value }))}
                  className={inputClass}
                >
                  {(Object.keys(SIGNATURE_LABELS) as SignatureStatus[]).map((key) => (
                    <option key={key} value={key}>{SIGNATURE_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Expected close</label>
                <input
                  type="date"
                  value={draft.expectedCloseDate}
                  onChange={(e) => setDraft((d) => ({ ...d, expectedCloseDate: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
            {draft.stage === 'lost' && (
              <div>
                <label className={labelClass}>Lost reason</label>
                <input
                  type="text"
                  placeholder="Why was this deal lost?"
                  value={draft.lostReason}
                  onChange={(e) => setDraft((d) => ({ ...d, lostReason: e.target.value }))}
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                className={inputClass}
              />
            </div>
            {deal.quote && (
              <Link
                href="/modules/quotes"
                target="_blank"
                className="inline-block text-xs font-semibold text-primary hover:text-primary/80"
              >
                Open {deal.quote.reference} in Quotes ({formatMoney(deal.quote.total, deal.currency)}) →
              </Link>
            )}
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={onDelete} className="text-sm font-medium text-rose-400 hover:text-rose-600">
                Delete deal
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>

          <ActivitySection
            activities={activities}
            contacts={contacts}
            onAdd={(type, summary, contactId) =>
              onAddActivity({ customerId: deal.customer.id, dealId: deal.id, contactId, type, summary })
            }
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Accounts (profiles)
// ---------------------------------------------------------------------------

function AccountsList({
  customers,
  accounts,
  deals,
  onOpen,
}: {
  customers: CrmCustomer[];
  accounts: CustomerAccount[];
  deals: DealSummary[];
  onOpen: (customerId: number) => void;
}) {
  const [query, setQuery] = useState('');

  const balanceById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const openDealsById = useMemo(() => {
    const map = new Map<number, number>();
    for (const deal of deals) {
      if (['closed', 'lost'].includes(deal.stage)) continue;
      map.set(deal.customer.id, (map.get(deal.customer.id) ?? 0) + 1);
    }
    return map;
  }, [deals]);

  const q = query.trim().toLowerCase();
  const filtered = customers.filter(
    (c) =>
      q.length === 0 ||
      c.name.toLowerCase().includes(q) ||
      (c.company?.toLowerCase().includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false) ||
      c.contacts.some((contact) => contact.name.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-3">
        <input
          type="text"
          placeholder="Search accounts, companies, or contacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={inputClass}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <h3 className="text-lg font-semibold text-gray-900">No accounts found</h3>
          <p className="mt-1 text-sm text-gray-500">Try a different search, entity, or add a new customer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((customer) => {
            const account = balanceById.get(customer.id);
            const style = entityStyle(customer.entity);
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => onOpen(customer.id)}
                className="rounded-2xl border border-gray-100 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
                      {initials(customer.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{customer.name}</p>
                      <p className="truncate text-xs text-gray-400">{customer.company || customer.email || '—'}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>
                    {customer.entity}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-gray-50 py-2">
                    <p className="text-sm font-bold text-gray-900">{customer.contacts.length}</p>
                    <p className="text-[10px] text-gray-400">Contacts</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 py-2">
                    <p className="text-sm font-bold text-gray-900">{openDealsById.get(customer.id) ?? 0}</p>
                    <p className="text-[10px] text-gray-400">Open deals</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 py-2">
                    <p className={`text-sm font-bold ${account && account.balance > 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                      {account ? formatCompactMoney(account.balance, account.currency) : '—'}
                    </p>
                    <p className="text-[10px] text-gray-400">Balance</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CustomerDrawer({
  customer,
  account,
  deals,
  activities,
  onClose,
  onSave,
  onAddContact,
  onAddActivity,
  onOpenDeal,
}: {
  customer: CrmCustomer;
  account: CustomerAccount | null;
  deals: DealSummary[];
  activities: CrmActivitySummary[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<string | null>;
  onAddContact: (draft: { name: string; role: string; email: string; phone: string }) => Promise<string | null>;
  onAddActivity: (input: {
    customerId: number;
    dealId?: number | null;
    contactId?: number | null;
    type: ActivityType;
    summary: string;
  }) => Promise<string | null>;
  onOpenDeal: (dealId: number) => void;
}) {
  const [draft, setDraft] = useState({
    name: customer.name,
    company: customer.company ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    billingAddress: customer.billingAddress ?? '',
    entity: customer.entity,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name: '', role: '', email: '', phone: '' });
  const [contactError, setContactError] = useState<string | null>(null);
  const [addingContact, setAddingContact] = useState(false);

  useEffect(() => {
    setDraft({
      name: customer.name,
      company: customer.company ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      billingAddress: customer.billingAddress ?? '',
      entity: customer.entity,
    });
    setError(null);
  }, [customer]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const message = await onSave({
      name: draft.name,
      company: draft.company || null,
      email: draft.email || null,
      phone: draft.phone || null,
      address: draft.address || null,
      billingAddress: draft.billingAddress || null,
      entity: draft.entity,
    });
    setSaving(false);
    if (message) setError(message);
  };

  const submitContact = async () => {
    if (!contactDraft.name.trim()) {
      setContactError('Contact name is required');
      return;
    }
    setAddingContact(true);
    setContactError(null);
    const message = await onAddContact(contactDraft);
    setAddingContact(false);
    if (message) {
      setContactError(message);
    } else {
      setContactDraft({ name: '', role: '', email: '', phone: '' });
      setShowContactForm(false);
    }
  };

  const style = entityStyle(customer.entity);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        <div className="bg-primary px-6 py-6 text-white sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold tracking-tight">{customer.name}</h2>
              <p className="mt-1 truncate text-sm text-white/60">{customer.company || customer.email || 'Customer profile'}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{customer.entity}</span>
            {account && (
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Open balance</p>
                <p className="text-2xl font-bold">{formatMoney(account.balance, account.currency)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-7 px-6 py-6 sm:px-8">
          {/* Profile */}
          <section>
            <SectionHeading title="Profile" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Name</label>
                <input type="text" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Entity</label>
                <select value={draft.entity} onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))} className={inputClass}>
                  {ENTITIES.map((entity) => (
                    <option key={entity} value={entity}>{entity}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Company</label>
                <input type="text" value={draft.company} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input type="text" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Address</label>
                <input type="text" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Billing address</label>
                <input
                  type="text"
                  value={draft.billingAddress}
                  onChange={(e) => setDraft((d) => ({ ...d, billingAddress: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
            {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </section>

          {/* Contacts */}
          <section>
            <SectionHeading
              title={`Contacts (${customer.contacts.length})`}
              action={
                <button
                  type="button"
                  onClick={() => setShowContactForm((v) => !v)}
                  className="text-xs font-semibold text-primary hover:text-primary/80"
                >
                  {showContactForm ? 'Cancel' : '+ Add contact'}
                </button>
              }
            />
            {showContactForm && (
              <div className="mb-3 space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input type="text" placeholder="Name *" value={contactDraft.name} onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))} className={inputClass} />
                  <input type="text" placeholder="Job title" value={contactDraft.role} onChange={(e) => setContactDraft((d) => ({ ...d, role: e.target.value }))} className={inputClass} />
                  <input type="email" placeholder="Email" value={contactDraft.email} onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))} className={inputClass} />
                  <input type="text" placeholder="Phone" value={contactDraft.phone} onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))} className={inputClass} />
                </div>
                {contactError && <p className="text-sm font-medium text-rose-600">{contactError}</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={submitContact}
                    disabled={addingContact}
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                  >
                    {addingContact ? 'Adding…' : 'Add contact'}
                  </button>
                </div>
              </div>
            )}
            {customer.contacts.length === 0 && !showContactForm ? (
              <p className="py-4 text-center text-sm text-gray-400">No contacts yet for this account.</p>
            ) : (
              <div className="space-y-2">
                {customer.contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${style.dot}`}>
                      {initials(contact.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{contact.name}</p>
                      <p className="truncate text-xs text-gray-400">{contact.role || '—'}</p>
                    </div>
                    <div className="min-w-0 text-right text-xs text-gray-500">
                      {contact.email && <p className="truncate">{contact.email}</p>}
                      {contact.phone && <p className="truncate text-gray-400">{contact.phone}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Deals */}
          <section>
            <SectionHeading title={`Deals (${deals.length})`} />
            {deals.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">No deals for this account yet.</p>
            ) : (
              <div className="space-y-2">
                {deals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    onClick={() => onOpenDeal(deal.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-white"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{deal.title}</p>
                      <p className="text-xs text-gray-400">
                        {STAGE_LABELS[deal.stage]}
                        {deal.isOutstanding && ' · Outstanding 30+ d'}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-gray-900">{formatCompactMoney(deal.value, deal.currency)}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Communication history */}
          <ActivitySection
            activities={activities}
            contacts={customer.contacts}
            onAdd={(type, summary, contactId) => onAddActivity({ customerId: customer.id, contactId, type, summary })}
          />

          {/* Receivables */}
          {account && (
            <section>
              <SectionHeading title="Receivables" />
              <div className="grid grid-cols-3 gap-2.5">
                <Cell label="Billed" value={formatMoney(account.totalBilled, account.currency)} />
                <Cell label="Collected" value={formatMoney(account.totalPaid, account.currency)} />
                <Cell
                  label="Overdue"
                  value={formatMoney(account.overdue, account.currency)}
                  accent={account.overdue > 0 ? 'text-rose-600' : undefined}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared activity timeline + composer
// ---------------------------------------------------------------------------

function ActivitySection({
  activities,
  contacts,
  onAdd,
}: {
  activities: CrmActivitySummary[];
  contacts: CrmContact[];
  onAdd: (type: ActivityType, summary: string, contactId: number | null) => Promise<string | null>;
}) {
  const [type, setType] = useState<ActivityType>('note');
  const [summary, setSummary] = useState('');
  const [contactId, setContactId] = useState(0);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!summary.trim() || posting) return;
    setPosting(true);
    setError(null);
    const message = await onAdd(type, summary.trim(), contactId || null);
    setPosting(false);
    if (message) {
      setError(message);
    } else {
      setSummary('');
      setContactId(0);
    }
  };

  return (
    <section>
      <SectionHeading title="Communication history" />
      <div className="mb-3 space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {ACTIVITY_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setType(option.key)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                type === option.key ? 'bg-primary text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              {option.icon} {option.label}
            </button>
          ))}
          {contacts.length > 0 && (
            <select
              value={contactId}
              onChange={(e) => setContactId(Number(e.target.value))}
              className="ml-auto rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value={0}>No contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={`Log a ${type}…`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            className={inputClass}
          />
          <button
            type="button"
            onClick={submit}
            disabled={posting || !summary.trim()}
            className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {posting ? '…' : 'Log'}
          </button>
        </div>
        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
      </div>

      {activities.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">No communication logged yet.</p>
      ) : (
        <div className="space-y-2.5">
          {activities.map((activity) => {
            const meta = ACTIVITY_META[activity.type] ?? ACTIVITY_META.note;
            return (
              <div key={activity.id} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm">
                  {meta.icon}
                </div>
                <div className="min-w-0 flex-1 rounded-xl border border-gray-100 bg-white p-3">
                  <p className="text-sm text-gray-800">{activity.summary}</p>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {meta.label}
                    {activity.contactName ? ` with ${activity.contactName}` : ''} · {activity.createdBy} ·{' '}
                    {formatDateTime(activity.occurredAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Receivables (previous accounts view)
// ---------------------------------------------------------------------------

type ReceivablesFilter = 'All' | AccountStatus;
const RECEIVABLES_FILTERS: ReceivablesFilter[] = ['All', 'Overdue', 'Open', 'Settled', 'New'];

function ReceivablesView({
  accounts,
  currency,
  onOpen,
}: {
  accounts: CustomerAccount[];
  currency: string;
  onOpen: (accountId: number) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ReceivablesFilter>('All');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch =
        q.length === 0 ||
        account.name.toLowerCase().includes(q) ||
        (account.company?.toLowerCase().includes(q) ?? false) ||
        (account.email?.toLowerCase().includes(q) ?? false);
      const matchesFilter = activeFilter === 'All' || account.status === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [accounts, searchQuery, activeFilter]);

  const totals = useMemo(
    () => ({
      receivable: accounts.reduce((acc, a) => acc + a.balance, 0),
      overdue: accounts.reduce((acc, a) => acc + a.overdue, 0),
      collected: accounts.reduce((acc, a) => acc + a.totalPaid, 0),
      active: accounts.filter((a) => a.balance > 0).length,
    }),
    [accounts],
  );

  const hasAccounts = accounts.length > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <SummaryCard label="Total receivable" value={formatMoney(totals.receivable, currency)} accent="text-primary" />
        <SummaryCard
          label="Overdue"
          value={formatMoney(totals.overdue, currency)}
          accent={totals.overdue > 0 ? 'text-rose-600' : 'text-gray-900'}
        />
        <SummaryCard label="Collected" value={formatMoney(totals.collected, currency)} />
        <SummaryCard label="Open accounts" value={`${totals.active}`} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by name, company, or email…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {RECEIVABLES_FILTERS.map((status) => (
            <button
              type="button"
              key={status}
              onClick={() => setActiveFilter(status)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {filtered.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => onOpen(account.id)}
            className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={account.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{account.name}</p>
                  {account.company && <p className="truncate text-xs text-gray-400">{account.company}</p>}
                </div>
              </div>
              <StatusBadge status={account.status} />
            </div>
            <div className="mt-3 flex items-end justify-between">
              <p className="text-xs text-gray-400">Last activity {formatDate(account.lastActivity)}</p>
              <p className="text-base font-bold text-gray-900">{formatMoney(account.balance, account.currency)}</p>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <EmptyState filtered={hasAccounts} />}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Account</th>
              <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Open balance</th>
              <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Overdue</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Last activity</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((account) => (
              <tr
                key={account.id}
                onClick={() => onOpen(account.id)}
                className="group cursor-pointer transition-colors hover:bg-gray-50/70"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={account.name} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                        {account.name}
                      </p>
                      <p className="truncate text-xs text-gray-400">
                        {account.company || account.email || `${account.invoiceCount} invoices`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <p className="text-sm font-semibold text-gray-900">{formatMoney(account.balance, account.currency)}</p>
                  {account.openCount > 0 && <p className="text-xs text-gray-400">{account.openCount} open</p>}
                </td>
                <td className="px-6 py-4 text-right">
                  <p className={`text-sm font-semibold ${account.overdue > 0 ? 'text-rose-600' : 'text-gray-300'}`}>
                    {account.overdue > 0 ? formatMoney(account.overdue, account.currency) : '—'}
                  </p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-500">{formatDate(account.lastActivity)}</p>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={account.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState filtered={hasAccounts} />}
      </div>
    </div>
  );
}

function ReceivablesDrawer({ account, onClose }: { account: CustomerAccount; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        <div className="relative overflow-hidden bg-primary px-6 py-6 text-white sm:px-8 sm:py-8">
          <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold tracking-tight">{account.name}</h2>
              <p className="mt-1 truncate text-sm text-white/60">{account.company || account.email || 'Customer account'}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.status === 'Overdue' ? 'bg-rose-400/30' : 'bg-white/15'} text-white`}>
              {account.status}
            </span>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Open balance</p>
              <p className="text-2xl font-bold">{formatMoney(account.balance, account.currency)}</p>
            </div>
          </div>
          <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
        </div>

        <div className="flex-1 space-y-7 px-6 py-6 sm:px-8">
          <div className="grid grid-cols-3 gap-2.5">
            <Cell label="Billed" value={formatMoney(account.totalBilled, account.currency)} />
            <Cell label="Collected" value={formatMoney(account.totalPaid, account.currency)} />
            <Cell label="Overdue" value={formatMoney(account.overdue, account.currency)} accent={account.overdue > 0 ? 'text-rose-600' : undefined} />
          </div>

          {(account.email || account.phone || account.billingAddress) && (
            <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5 text-sm">
              {account.email && <p className="text-gray-700">{account.email}</p>}
              {account.phone && <p className="text-gray-500">{account.phone}</p>}
              {account.billingAddress && <p className="mt-1 whitespace-pre-wrap text-gray-500">{account.billingAddress}</p>}
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Invoices</h3>
              <Link href="/modules/invoices-review" target="_blank" className="text-xs font-semibold text-primary hover:text-primary/80">
                Go to invoices →
              </Link>
            </div>
            {account.invoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No invoices yet for this account.</p>
            ) : (
              <div className="space-y-2">
                {account.invoices.map((invoice) => {
                  const label = invoice.isOverdue ? 'Overdue' : invoice.status;
                  return (
                    <a
                      key={invoice.id}
                      href={`/modules/invoices-review/${invoice.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 transition-colors hover:border-primary/30 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{invoice.number}</p>
                        <p className="text-xs text-gray-400">
                          Issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_STYLES[label] ?? INVOICE_STATUS_STYLES.Draft}`}>
                          {label}
                        </span>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900">{formatMoney(invoice.total, invoice.currency)}</p>
                          {invoice.balanceDue > 0 && (
                            <p className="text-xs text-gray-400">{formatMoney(invoice.balanceDue, invoice.currency)} due</p>
                          )}
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function NewDealModal({
  customers,
  quoteOptions,
  currency,
  onClose,
  onCreated,
}: {
  customers: CrmCustomer[];
  quoteOptions: QuoteOption[];
  currency: string;
  onClose: () => void;
  onCreated: (deal: DealSummary) => void;
}) {
  const [draft, setDraft] = useState({
    title: '',
    customerId: 0,
    stage: 'lead',
    value: '',
    quoteId: 0,
    expectedCloseDate: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customerQuotes = quoteOptions.filter((q) => q.customerId === draft.customerId);

  const submit = async () => {
    setError(null);
    if (!draft.title.trim()) {
      setError('Deal title is required');
      return;
    }
    if (!draft.customerId) {
      setError('Pick a customer');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/crm/deals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          customerId: draft.customerId,
          stage: draft.stage,
          value: Number(draft.value) || 0,
          currency,
          quoteId: draft.quoteId || null,
          expectedCloseDate: draft.expectedCloseDate || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as { deal?: DealSummary; error?: string } | null;
      if (!res.ok || !data?.deal) {
        setError(data?.error ?? 'Could not create deal');
        return;
      }
      onCreated(data.deal);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New deal" onClose={saving ? () => undefined : onClose}>
      <div className="space-y-3 px-6 py-5">
        <input
          type="text"
          placeholder="Deal title *"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className={inputClass}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            value={draft.customerId}
            onChange={(e) => setDraft((d) => ({ ...d, customerId: Number(e.target.value), quoteId: 0 }))}
            className={inputClass}
          >
            <option value={0}>Customer *</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} ({customer.entity})
              </option>
            ))}
          </select>
          <select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value }))} className={inputClass}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={`Value (${currency})`}
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            className={inputClass}
          />
          <input
            type="date"
            value={draft.expectedCloseDate}
            onChange={(e) => setDraft((d) => ({ ...d, expectedCloseDate: e.target.value }))}
            className={inputClass}
          />
        </div>
        {customerQuotes.length > 0 && (
          <select value={draft.quoteId} onChange={(e) => setDraft((d) => ({ ...d, quoteId: Number(e.target.value) }))} className={inputClass}>
            <option value={0}>Link a quote (optional)</option>
            {customerQuotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.reference} · {q.subject} · {q.status}
              </option>
            ))}
          </select>
        )}
        <textarea
          rows={2}
          placeholder="Notes"
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          className={inputClass}
        />
        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Create deal" />
    </Modal>
  );
}

function NewCustomerModal({
  currency,
  onClose,
  onCreated,
}: {
  currency: string;
  onClose: () => void;
  onCreated: (customer: CrmCustomer, account: CustomerAccount) => void;
}) {
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    billingAddress: '',
    entity: 'LADYASKARI' as string,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Customer name is required');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim() || null,
          company: draft.company.trim() || null,
          address: null,
          billingAddress: draft.billingAddress.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            customer?: {
              id: number;
              name: string;
              email: string | null;
              phone: string | null;
              company: string | null;
              billingAddress: string | null;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !data?.customer) {
        setError(data?.error ?? 'Could not create customer');
        return;
      }

      // Entity lives on the CRM layer — set it after creation when non-default.
      if (draft.entity !== 'LADYASKARI') {
        await fetch(`/api/crm/customers/${data.customer.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity: draft.entity }),
        }).catch(() => null);
      }

      onCreated(
        {
          id: data.customer.id,
          name: data.customer.name,
          email: data.customer.email,
          phone: data.customer.phone,
          company: data.customer.company,
          address: null,
          billingAddress: data.customer.billingAddress,
          entity: draft.entity,
          contacts: [],
          dealCount: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: data.customer.id,
          name: data.customer.name,
          email: data.customer.email,
          company: data.customer.company,
          phone: data.customer.phone,
          billingAddress: data.customer.billingAddress,
          status: 'New',
          balance: 0,
          totalBilled: 0,
          totalPaid: 0,
          overdue: 0,
          invoiceCount: 0,
          openCount: 0,
          lastActivity: null,
          currency,
          invoices: [],
        },
      );
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New customer" onClose={saving ? () => undefined : onClose}>
      <div className="space-y-3 px-6 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Customer name *"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className={inputClass}
          />
          <select value={draft.entity} onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))} className={inputClass}>
            {ENTITIES.map((entity) => (
              <option key={entity} value={entity}>{entity}</option>
            ))}
          </select>
          <input
            type="email"
            placeholder="Email"
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Phone"
            value={draft.phone}
            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            className={inputClass}
          />
        </div>
        <input
          type="text"
          placeholder="Company"
          value={draft.company}
          onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Billing address"
          value={draft.billingAddress}
          onChange={(e) => setDraft((d) => ({ ...d, billingAddress: e.target.value }))}
          className={inputClass}
        />
        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Add customer" />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

function ModalFooter({
  onClose,
  onSubmit,
  saving,
  submitLabel,
}: {
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
      <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving}
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}

function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      {action}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.New}`}>
      {status}
    </span>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching accounts' : 'No accounts yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or filter.' : 'Add a customer or create an invoice to get started.'}
      </p>
    </div>
  );
}

function Cell({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
