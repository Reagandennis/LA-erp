'use client';

import { useState } from 'react';

type InvoiceStatus =
  | 'Pending Review'
  | 'Needs Correction'
  | 'Approved'
  | 'Escalated';
type RiskLevel = 'Low' | 'Medium' | 'High';
type ReviewState = 'Complete' | 'Pending';

interface ReviewCheck {
  id: string;
  label: string;
  state: ReviewState;
}

interface InvoiceLineItem {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceActivity {
  id: string;
  actor: string;
  action: string;
  time: string;
}

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  vendor: string;
  vendorCode: string;
  submittedAt: string;
  dueDate: string;
  amount: number;
  status: InvoiceStatus;
  risk: RiskLevel;
  paymentTerms: string;
  assignedReviewer: string;
  costCenter: string;
  project: string;
  submissionChannel: 'Portal' | 'Email' | 'Manual';
  flags: string[];
  summary: string;
  checks: ReviewCheck[];
  lineItems: InvoiceLineItem[];
  activity: InvoiceActivity[];
}

interface InvoiceTemplateLine {
  id: string;
  item: string;
  quantity: number;
  units: number;
  days: number;
  rate: number;
}

interface InvoiceTemplateSection {
  id: string;
  title: string;
  content: string;
}

interface InvoiceTemplate {
  id: string;
  name: string;
  description: string;
  chip: string;
  companyName: string;
  companyLogoLabel: string;
  companyAddress: string;
  clientName: string;
  clientAddress: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  costCenter: string;
  project: string;
  taxLabel: string;
  taxRate: number;
  terms: string;
  notes: string;
  lineItems: InvoiceTemplateLine[];
  extraSections: InvoiceTemplateSection[];
}

const INVOICES: InvoiceRecord[] = [
  {
    id: 'INV-QUEUE-1001',
    invoiceNumber: 'LS-88324',
    vendor: 'Lady Askari Field Operations',
    vendorCode: 'VND-014',
    submittedAt: 'Mar 30, 2026 · 08:15',
    dueDate: 'Apr 07, 2026',
    amount: 18450,
    status: 'Pending Review',
    risk: 'Medium',
    paymentTerms: 'Net 7',
    assignedReviewer: 'Njeri Mutiso',
    costCenter: 'Operations',
    project: 'Northern Corridor Deployment',
    submissionChannel: 'Portal',
    flags: ['Missing delivery note', 'Urgent payment request'],
    summary:
      'Monthly patrol deployment invoice covering shift coverage, transport allocation, and on-site supervision.',
    checks: [
      { id: 'c1', label: 'Vendor match confirmed', state: 'Complete' },
      { id: 'c2', label: 'PO reference attached', state: 'Pending' },
      { id: 'c3', label: 'Service window validated', state: 'Complete' },
      { id: 'c4', label: 'Tax breakdown verified', state: 'Pending' },
    ],
    lineItems: [
      {
        id: 'l1',
        label: 'Guard deployment coverage',
        quantity: 42,
        unitPrice: 260,
        total: 10920,
      },
      {
        id: 'l2',
        label: 'Site supervisor allocation',
        quantity: 6,
        unitPrice: 540,
        total: 3240,
      },
      {
        id: 'l3',
        label: 'Transport coordination',
        quantity: 11,
        unitPrice: 390,
        total: 4290,
      },
    ],
    activity: [
      {
        id: 'a1',
        actor: 'Portal Intake',
        action: 'Submitted to finance queue',
        time: '08:15',
      },
      {
        id: 'a2',
        actor: 'Auto Rules',
        action: 'Flagged missing delivery note',
        time: '08:17',
      },
      {
        id: 'a3',
        actor: 'Njeri Mutiso',
        action: 'Opened for review',
        time: '09:06',
      },
    ],
  },
  {
    id: 'INV-QUEUE-1002',
    invoiceNumber: 'GL-21903',
    vendor: 'Global Logistics Corp',
    vendorCode: 'VND-022',
    submittedAt: 'Mar 29, 2026 · 16:42',
    dueDate: 'Apr 15, 2026',
    amount: 32680,
    status: 'Approved',
    risk: 'Low',
    paymentTerms: 'Net 15',
    assignedReviewer: 'Faith Odhiambo',
    costCenter: 'Logistics',
    project: 'Fleet Rotation Program',
    submissionChannel: 'Email',
    flags: ['Budget within threshold'],
    summary:
      'Fleet fuel, dispatch support, and route standby services cleared against the approved logistics budget.',
    checks: [
      { id: 'c1', label: 'Vendor match confirmed', state: 'Complete' },
      { id: 'c2', label: 'PO reference attached', state: 'Complete' },
      { id: 'c3', label: 'Service window validated', state: 'Complete' },
      { id: 'c4', label: 'Tax breakdown verified', state: 'Complete' },
    ],
    lineItems: [
      {
        id: 'l1',
        label: 'Fuel support batch',
        quantity: 1,
        unitPrice: 14800,
        total: 14800,
      },
      {
        id: 'l2',
        label: 'Dispatch standby',
        quantity: 8,
        unitPrice: 1190,
        total: 9520,
      },
      {
        id: 'l3',
        label: 'Route contingency support',
        quantity: 6,
        unitPrice: 1393.33,
        total: 8360,
      },
    ],
    activity: [
      {
        id: 'a1',
        actor: 'Finance Intake',
        action: 'Imported from accounts mailbox',
        time: '16:42',
      },
      {
        id: 'a2',
        actor: 'Faith Odhiambo',
        action: 'Approved for payment',
        time: '17:25',
      },
      {
        id: 'a3',
        actor: 'Treasury Queue',
        action: 'Scheduled for next payment run',
        time: '17:33',
      },
    ],
  },
  {
    id: 'INV-QUEUE-1003',
    invoiceNumber: 'TF-78110',
    vendor: 'TechFlow Solutions',
    vendorCode: 'VND-041',
    submittedAt: 'Mar 31, 2026 · 07:48',
    dueDate: 'Apr 03, 2026',
    amount: 9750,
    status: 'Needs Correction',
    risk: 'High',
    paymentTerms: 'Net 3',
    assignedReviewer: 'Kelvin Njoroge',
    costCenter: 'Technology',
    project: 'Control Room Upgrade',
    submissionChannel: 'Portal',
    flags: ['Duplicate line item', 'VAT mismatch', 'Expired quote reference'],
    summary:
      'Infrastructure support invoice for control room upgrades requiring supplier clarification before approval.',
    checks: [
      { id: 'c1', label: 'Vendor match confirmed', state: 'Complete' },
      { id: 'c2', label: 'PO reference attached', state: 'Pending' },
      { id: 'c3', label: 'Service window validated', state: 'Pending' },
      { id: 'c4', label: 'Tax breakdown verified', state: 'Pending' },
    ],
    lineItems: [
      {
        id: 'l1',
        label: 'Rack configuration support',
        quantity: 3,
        unitPrice: 1250,
        total: 3750,
      },
      {
        id: 'l2',
        label: 'Cabling and commissioning',
        quantity: 2,
        unitPrice: 1800,
        total: 3600,
      },
      {
        id: 'l3',
        label: 'Remote validation session',
        quantity: 2,
        unitPrice: 1200,
        total: 2400,
      },
    ],
    activity: [
      {
        id: 'a1',
        actor: 'Portal Intake',
        action: 'Submitted to finance queue',
        time: '07:48',
      },
      {
        id: 'a2',
        actor: 'Auto Rules',
        action: 'Raised high-risk validation alert',
        time: '07:49',
      },
      {
        id: 'a3',
        actor: 'Kelvin Njoroge',
        action: 'Sent correction request draft',
        time: '08:34',
      },
    ],
  },
  {
    id: 'INV-QUEUE-1004',
    invoiceNumber: 'HP-44021',
    vendor: 'Horizon Partners',
    vendorCode: 'VND-008',
    submittedAt: 'Mar 28, 2026 · 13:20',
    dueDate: 'Apr 10, 2026',
    amount: 44800,
    status: 'Escalated',
    risk: 'High',
    paymentTerms: 'Net 14',
    assignedReviewer: 'Asha Kibet',
    costCenter: 'Executive Accounts',
    project: 'Regional Expansion',
    submissionChannel: 'Manual',
    flags: ['Approval threshold exceeded', 'Executive sign-off required'],
    summary:
      'Regional advisory and mobilization charges routed for executive review due to threshold and strategic spend rules.',
    checks: [
      { id: 'c1', label: 'Vendor match confirmed', state: 'Complete' },
      { id: 'c2', label: 'PO reference attached', state: 'Complete' },
      { id: 'c3', label: 'Service window validated', state: 'Complete' },
      { id: 'c4', label: 'Tax breakdown verified', state: 'Pending' },
    ],
    lineItems: [
      {
        id: 'l1',
        label: 'Market readiness workshop',
        quantity: 4,
        unitPrice: 6200,
        total: 24800,
      },
      {
        id: 'l2',
        label: 'Regional mobilization support',
        quantity: 2,
        unitPrice: 10000,
        total: 20000,
      },
    ],
    activity: [
      {
        id: 'a1',
        actor: 'Front Office',
        action: 'Manually keyed into queue',
        time: '13:20',
      },
      {
        id: 'a2',
        actor: 'Asha Kibet',
        action: 'Escalated for executive sign-off',
        time: '14:06',
      },
      {
        id: 'a3',
        actor: 'CFO Desk',
        action: 'Awaiting secondary approval',
        time: '14:31',
      },
    ],
  },
];

const INITIAL_TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'ops-retainer',
    name: 'Operations Retainer',
    description: 'Recurring deployment, shift cover, and support billing.',
    chip: 'Monthly',
    companyName: 'Lady Askari Limited',
    companyLogoLabel: 'LA',
    companyAddress:
      'Lady Askari House\nMombasa Road, Nairobi\n+254 700 000 000\nfinance@ladyaskari.com',
    clientName: 'Northgate Industrial Park',
    clientAddress:
      'Procurement Office\nWarehouse District, Nairobi\naccounts@northgate.example',
    invoiceNumber: 'OPS-2026-014',
    issueDate: '2026-03-31',
    dueDate: '2026-04-07',
    paymentTerms: 'Net 7',
    costCenter: 'Operations',
    project: 'Northern Corridor Deployment',
    taxLabel: 'VAT',
    taxRate: 16,
    terms:
      'Payment is due within the agreed payment term. Late settlement may pause active deployment support until the account is regularized.',
    notes:
      'Attach shift attendance sheets and signed deployment summary before sending the final invoice to the client.',
    lineItems: [
      {
        id: 't1',
        item: 'Guard deployment coverage',
        quantity: 3,
        units: 14,
        days: 1,
        rate: 260,
      },
      {
        id: 't2',
        item: 'Site supervisor allocation',
        quantity: 1,
        units: 4,
        days: 1,
        rate: 540,
      },
    ],
    extraSections: [
      {
        id: 's1',
        title: 'Banking Details',
        content:
          'Bank: Equity Bank\nAccount Name: Lady Askari Limited\nAccount Number: 00123456789',
      },
    ],
  },
  {
    id: 'fleet-support',
    name: 'Fleet Support',
    description: 'Fuel, standby, and route support invoice pattern.',
    chip: 'Logistics',
    companyName: 'Lady Askari Mobility Services',
    companyLogoLabel: 'LM',
    companyAddress:
      'Transit Annex\nEnterprise Road, Nairobi\n+254 711 555 555\nmobility@ladyaskari.com',
    clientName: 'Eastline Freight Group',
    clientAddress:
      'Fleet Accounts Team\nIndustrial Area, Nairobi\nfinance@eastline.example',
    invoiceNumber: 'FLT-2026-008',
    issueDate: '2026-03-30',
    dueDate: '2026-04-15',
    paymentTerms: 'Net 15',
    costCenter: 'Logistics',
    project: 'Fleet Rotation Program',
    taxLabel: 'VAT',
    taxRate: 16,
    terms:
      'Rates exclude any emergency dispatch outside the approved service plan. Additional standby days are billed separately.',
    notes:
      'Route dispatch sheets and fuel summaries should be grouped by week to make client verification faster.',
    lineItems: [
      {
        id: 't3',
        item: 'Fuel support batch',
        quantity: 1,
        units: 1,
        days: 1,
        rate: 14800,
      },
      {
        id: 't4',
        item: 'Dispatch standby',
        quantity: 2,
        units: 3,
        days: 1,
        rate: 1190,
      },
    ],
    extraSections: [
      {
        id: 's2',
        title: 'Support Window',
        content:
          'Primary dispatch support covers Monday to Saturday.\nEmergency after-hours support is billed separately.',
      },
    ],
  },
  {
    id: 'tech-upgrade',
    name: 'Technology Upgrade',
    description: 'Infrastructure, cabling, and commissioning invoice starter.',
    chip: 'Project',
    companyName: 'Lady Askari Technology',
    companyLogoLabel: 'LT',
    companyAddress:
      'Control Room Lab\nWestlands, Nairobi\n+254 733 222 222\ntechnology@ladyaskari.com',
    clientName: 'Summit Security Holdings',
    clientAddress:
      'Projects Office\nUpper Hill, Nairobi\nprojects@summit.example',
    invoiceNumber: 'TEC-2026-004',
    issueDate: '2026-03-31',
    dueDate: '2026-04-03',
    paymentTerms: 'Net 3',
    costCenter: 'Technology',
    project: 'Control Room Upgrade',
    taxLabel: 'VAT',
    taxRate: 16,
    terms:
      'Infrastructure changes are billed against the accepted scope. Any variation order or additional equipment approval is invoiced separately.',
    notes:
      'Reference the signed commissioning memo and include the approved equipment sheet with every invoice.',
    lineItems: [
      {
        id: 't5',
        item: 'Rack configuration support',
        quantity: 1,
        units: 2,
        days: 1,
        rate: 1250,
      },
      {
        id: 't6',
        item: 'Cabling and commissioning',
        quantity: 1,
        units: 2,
        days: 1,
        rate: 1800,
      },
    ],
    extraSections: [
      {
        id: 's3',
        title: 'Delivery Checklist',
        content:
          'Attach approved quote\nAttach device serial list\nAttach commissioning sign-off',
      },
    ],
  },
];

const STATUS_FILTERS = [
  'All',
  'Pending Review',
  'Needs Correction',
  'Approved',
  'Escalated',
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function getStatusClasses(status: InvoiceStatus) {
  switch (status) {
    case 'Pending Review':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'Needs Correction':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'Approved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'Escalated':
      return 'border-violet-200 bg-violet-50 text-violet-700';
  }
}

function getRiskClasses(risk: RiskLevel) {
  switch (risk) {
    case 'Low':
      return 'bg-emerald-500';
    case 'Medium':
      return 'bg-amber-500';
    case 'High':
      return 'bg-rose-500';
  }
}

function cloneTemplate(template: InvoiceTemplate): InvoiceTemplate {
  return {
    ...template,
    lineItems: template.lineItems.map((line) => ({ ...line })),
    extraSections: template.extraSections.map((section) => ({ ...section })),
  };
}

function getTemplateLineTotal(line: InvoiceTemplateLine) {
  return line.quantity * line.units * line.days * line.rate;
}

function getTemplateSubtotal(template: InvoiceTemplate) {
  return template.lineItems.reduce(
    (sum, line) => sum + getTemplateLineTotal(line),
    0,
  );
}

function getInitials(label: string) {
  const words = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return 'LA';
  }

  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export default function InvoicesReviewPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('All');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(INVOICES[0]?.id ?? '');
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    INITIAL_TEMPLATES[0].id,
  );
  const [templateDraft, setTemplateDraft] = useState<InvoiceTemplate>(() =>
    cloneTemplate(INITIAL_TEMPLATES[0]),
  );

  const filteredInvoices = INVOICES.filter((invoice) => {
    const normalizedQuery = searchQuery.toLowerCase();
    const matchesSearch =
      invoice.vendor.toLowerCase().includes(normalizedQuery) ||
      invoice.invoiceNumber.toLowerCase().includes(normalizedQuery) ||
      invoice.vendorCode.toLowerCase().includes(normalizedQuery) ||
      invoice.project.toLowerCase().includes(normalizedQuery);

    const matchesFilter =
      activeFilter === 'All' || invoice.status === activeFilter;

    return matchesSearch && matchesFilter;
  });

  const selectedInvoice =
    filteredInvoices.find((invoice) => invoice.id === selectedInvoiceId) ??
    filteredInvoices[0] ??
    null;

  const pendingCount = INVOICES.filter(
    (invoice) => invoice.status === 'Pending Review',
  ).length;
  const approvedTotal = INVOICES.filter(
    (invoice) => invoice.status === 'Approved',
  ).reduce((sum, invoice) => sum + invoice.amount, 0);
  const escalatedTotal = INVOICES.filter(
    (invoice) => invoice.status === 'Escalated',
  ).reduce((sum, invoice) => sum + invoice.amount, 0);

  const templateSubtotal = getTemplateSubtotal(templateDraft);
  const templateTaxAmount = (templateSubtotal * templateDraft.taxRate) / 100;
  const templateGrandTotal = templateSubtotal + templateTaxAmount;

  function loadTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setSelectedTemplateId(templateId);
    setTemplateDraft(cloneTemplate(template));
  }

  function updateTemplateField<K extends keyof InvoiceTemplate>(
    key: K,
    value: InvoiceTemplate[K],
  ) {
    setTemplateDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateTemplateLine(
    lineId: string,
    field: keyof InvoiceTemplateLine,
    value: string,
  ) {
    setTemplateDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((line) => {
        if (line.id !== lineId) {
          return line;
        }

        if (field === 'item') {
          return {
            ...line,
            item: value,
          };
        }

        const numericValue = Number(value);

        return {
          ...line,
          [field]: Number.isFinite(numericValue) ? numericValue : 0,
        };
      }),
    }));
  }

  function addTemplateLine() {
    setTemplateDraft((current) => ({
      ...current,
      lineItems: [
        ...current.lineItems,
        {
          id: `line-${current.lineItems.length + 1}`,
          item: 'New service line',
          quantity: 1,
          units: 1,
          days: 1,
          rate: 0,
        },
      ],
    }));
  }

  function removeTemplateLine(lineId: string) {
    setTemplateDraft((current) => ({
      ...current,
      lineItems:
        current.lineItems.length > 1
          ? current.lineItems.filter((line) => line.id !== lineId)
          : current.lineItems,
    }));
  }

  function updateExtraSection(
    sectionId: string,
    field: keyof InvoiceTemplateSection,
    value: string,
  ) {
    setTemplateDraft((current) => ({
      ...current,
      extraSections: current.extraSections.map((section) =>
        section.id === sectionId ? { ...section, [field]: value } : section,
      ),
    }));
  }

  function addExtraSection() {
    setTemplateDraft((current) => ({
      ...current,
      extraSections: [
        ...current.extraSections,
        {
          id: `section-${current.extraSections.length + 1}`,
          title: 'Additional Section',
          content: 'Add any extra invoice instruction, attachment note, or compliance requirement here.',
        },
      ],
    }));
  }

  function removeExtraSection(sectionId: string) {
    setTemplateDraft((current) => ({
      ...current,
      extraSections: current.extraSections.filter(
        (section) => section.id !== sectionId,
      ),
    }));
  }

  function saveTemplateChanges() {
    setTemplates((current) =>
      current.map((template) =>
        template.id === selectedTemplateId ? cloneTemplate(templateDraft) : template,
      ),
    );
  }

  function duplicateTemplate() {
    const duplicatedTemplate = cloneTemplate({
      ...templateDraft,
      id: `custom-${Date.now()}`,
      name: `${templateDraft.name} Copy`,
      chip: 'Custom',
    });

    setTemplates((current) => [...current, duplicatedTemplate]);
    setSelectedTemplateId(duplicatedTemplate.id);
    setTemplateDraft(duplicatedTemplate);
  }

  return (
    <main className="min-h-full bg-[#f3efe5] px-4 py-6 lg:px-6 lg:py-7">
      <div className="mx-auto max-w-[1540px] space-y-6">
        <section className="relative overflow-hidden rounded-[2.75rem] border border-black/5 bg-[#111827] px-6 py-7 text-white shadow-2xl lg:px-8 lg:py-8">
          <div className="absolute inset-y-0 right-0 w-[38%] bg-[radial-gradient(circle_at_top_right,_rgba(246,190,74,0.28),_transparent_58%)]" />
          <div className="absolute -right-20 top-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative z-10 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                  Finance Review Desk
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/55">
                  Invoice workspace
                </span>
              </div>

              <div className="space-y-2">
                <h1 className="max-w-3xl text-4xl font-black tracking-tight lg:text-[3.35rem] lg:leading-[1]">
                  Review invoices and shape reusable templates in the same flow.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-white/68 lg:text-base">
                  Keep the approval lane visible, then move straight into an editable
                  invoice template studio with brand, client, tax, terms, notes, and
                  custom sections ready for finance teams to tune.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button className="rounded-2xl bg-amber-300 px-5 py-3 text-sm font-black text-gray-950 transition hover:bg-amber-200">
                  Start Review Cycle
                </button>
                <button className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                  Export Invoice Template
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                  Waiting Review
                </p>
                <p className="mt-3 text-3xl font-black">{pendingCount}</p>
                <p className="mt-1 text-xs font-bold text-amber-300">
                  invoices still in active triage
                </p>
              </div>
              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                  Approved Today
                </p>
                <p className="mt-3 text-3xl font-black">{formatCurrency(approvedTotal)}</p>
                <p className="mt-1 text-xs font-bold text-emerald-300">
                  moved forward for payment
                </p>
              </div>
              <div className="rounded-[1.75rem] bg-[#f6be4a] p-5 text-gray-950">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-800/70">
                  Escalated Spend
                </p>
                <p className="mt-3 text-3xl font-black">{formatCurrency(escalatedTotal)}</p>
                <p className="mt-1 text-xs font-bold text-gray-800/70">
                  executive approval threshold exposure
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <svg
                className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search vendor, invoice number, vendor code, or project..."
                className="w-full rounded-2xl bg-[#f7f4ed] py-3 pl-12 pr-4 text-sm font-medium text-gray-700 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-amber-300"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`whitespace-nowrap rounded-2xl px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] transition ${
                    activeFilter === filter
                      ? 'bg-gray-900 text-white'
                      : 'bg-[#f7f4ed] text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[2.25rem] border border-black/5 bg-white p-5 shadow-sm lg:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                Review Lane
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-gray-950">
                Queue cards with room to breathe
              </h2>
            </div>
            <span className="rounded-full bg-[#f7f4ed] px-3 py-1 text-[10px] font-black text-gray-500">
              {filteredInvoices.length} invoices visible
            </span>
          </div>

          <div className="mt-5 flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {filteredInvoices.length > 0 ? (
              filteredInvoices.map((invoice) => {
                const isActive = invoice.id === selectedInvoice?.id;

                return (
                  <button
                    key={invoice.id}
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                    className={`min-w-[320px] max-w-[360px] flex-1 rounded-[2rem] border p-5 text-left transition ${
                      isActive
                        ? 'border-gray-900 bg-gray-900 text-white shadow-xl'
                        : 'border-gray-100 bg-[#fcfbf8] hover:border-amber-200 hover:bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p
                          className={`text-[10px] font-black uppercase tracking-[0.18em] ${
                            isActive ? 'text-white/40' : 'text-gray-400'
                          }`}
                        >
                          {invoice.vendorCode}
                        </p>
                        <h3 className="mt-2 text-xl font-black tracking-tight">
                          {invoice.vendor}
                        </h3>
                        <p
                          className={`mt-2 text-sm ${
                            isActive ? 'text-white/70' : 'text-gray-500'
                          }`}
                        >
                          {invoice.invoiceNumber} · {invoice.project}
                        </p>
                      </div>
                      <span
                        className={`mt-1 h-3 w-3 shrink-0 rounded-full ${getRiskClasses(
                          invoice.risk,
                        )}`}
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                          isActive
                            ? 'border-white/10 bg-white/10 text-white'
                            : getStatusClasses(invoice.status)
                        }`}
                      >
                        {invoice.status}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                          isActive
                            ? 'bg-white/10 text-white/75'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {invoice.risk} risk
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p
                          className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                            isActive ? 'text-white/35' : 'text-gray-400'
                          }`}
                        >
                          Submitted
                        </p>
                        <p className="mt-1 text-sm font-bold">{invoice.submittedAt}</p>
                      </div>
                      <div>
                        <p
                          className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                            isActive ? 'text-white/35' : 'text-gray-400'
                          }`}
                        >
                          Amount
                        </p>
                        <p className="mt-1 text-sm font-black">
                          {formatCurrency(invoice.amount)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="w-full rounded-[2rem] border border-dashed border-gray-200 bg-[#fcfbf8] p-12 text-center">
                <p className="text-xl font-black text-gray-900">
                  No invoices match the current filters.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Change the filter or search terms to reopen the lane.
                </p>
              </div>
            )}
          </div>
        </section>

        {selectedInvoice ? (
          <section className="space-y-6 rounded-[2.5rem] border border-black/5 bg-white p-6 shadow-sm lg:p-7">
            <div className="flex flex-col gap-5 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  Active Review Stage
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-black tracking-tight text-gray-950 lg:text-4xl">
                    {selectedInvoice.invoiceNumber}
                  </h2>
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${getStatusClasses(
                      selectedInvoice.status,
                    )}`}
                  >
                    {selectedInvoice.status}
                  </span>
                </div>
                <p className="max-w-4xl text-sm leading-7 text-gray-600 lg:text-base">
                  {selectedInvoice.summary}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-700 transition hover:bg-gray-50">
                  Request Correction
                </button>
                <button className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700">
                  Approve Invoice
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                ['Vendor', selectedInvoice.vendor],
                ['Reviewer', selectedInvoice.assignedReviewer],
                ['Due Date', selectedInvoice.dueDate],
                ['Amount', formatCurrency(selectedInvoice.amount)],
                ['Cost Center', selectedInvoice.costCenter],
                ['Project', selectedInvoice.project],
                ['Terms', selectedInvoice.paymentTerms],
                ['Channel', selectedInvoice.submissionChannel],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[1.6rem] bg-[#f7f4ed] px-4 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                    {label}
                  </p>
                  <p className="mt-2 text-sm font-black text-gray-900">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="space-y-6">
                <div className="rounded-[2rem] bg-[#f7f4ed] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Validation Board
                      </p>
                      <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                        Checklist progress
                      </h3>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black text-amber-700">
                      {
                        selectedInvoice.checks.filter(
                          (check) => check.state === 'Complete',
                        ).length
                      }
                      /{selectedInvoice.checks.length}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {selectedInvoice.checks.map((check) => (
                      <div
                        key={check.id}
                        className="flex items-center justify-between rounded-[1.4rem] bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-black ${
                              check.state === 'Complete'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#f7f4ed] text-gray-500'
                            }`}
                          >
                            {check.state === 'Complete' ? 'OK' : '...'}
                          </span>
                          <p className="text-sm font-bold text-gray-800">{check.label}</p>
                        </div>
                        <span
                          className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                            check.state === 'Complete'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {check.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[2rem] bg-[#111827] p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
                    Queue Flags
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedInvoice.flags.map((flag) => (
                      <span
                        key={flag}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-300"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Invoice Breakdown
                      </p>
                      <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                        Charge lines
                      </h3>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-gray-500">
                      {selectedInvoice.lineItems.length} items
                    </span>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[1.6rem] border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-[#f7f4ed]">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Item
                          </th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Qty
                          </th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Unit
                          </th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedInvoice.lineItems.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-4 text-sm font-bold text-gray-800">
                              {item.label}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600">
                              {item.quantity}
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-gray-600">
                              {formatCurrency(item.unitPrice)}
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-black text-gray-900">
                              {formatCurrency(item.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Review Timeline
                      </p>
                      <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                        Activity trail
                      </h3>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {selectedInvoice.activity.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3">
                        <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-gray-900" />
                        <div>
                          <p className="text-sm font-black text-gray-900">
                            {entry.actor}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">{entry.action}</p>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            {entry.time}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="space-y-6 rounded-[2.5rem] border border-black/5 bg-white p-6 shadow-sm lg:p-7">
          <div className="flex flex-col gap-5 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                Template Studio
              </p>
              <h2 className="text-3xl font-black tracking-tight text-gray-950 lg:text-4xl">
                Edit the invoice structure, not just the numbers.
              </h2>
              <p className="max-w-4xl text-sm leading-7 text-gray-600 lg:text-base">
                Users can edit the company logo mark, company and client details,
                line items, units, number of days, tax, terms and conditions, notes,
                and add custom sections for any other invoice content they need.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveTemplateChanges}
                className="rounded-2xl border border-gray-200 px-5 py-3 text-sm font-black text-gray-700 transition hover:bg-gray-50"
              >
                Save Current Template
              </button>
              <button
                onClick={duplicateTemplate}
                className="rounded-2xl bg-amber-300 px-5 py-3 text-sm font-black text-gray-950 transition hover:bg-amber-200"
              >
                Duplicate as New Template
              </button>
            </div>
          </div>

          <section className="rounded-[2rem] bg-[#f7f4ed] p-5 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Template Library
                </p>
                <h3 className="mt-1 text-2xl font-black tracking-tight text-gray-950">
                  Pick a template to edit
                </h3>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
                {templates.length} templates
              </span>
            </div>

            <div className="mt-5 flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {templates.map((template) => {
                const isSelected = template.id === selectedTemplateId;

                return (
                  <button
                    key={template.id}
                    onClick={() => loadTemplate(template.id)}
                    className={`min-w-[320px] rounded-[2rem] border p-5 text-left transition ${
                      isSelected
                        ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                        : 'border-white bg-white hover:border-amber-200 hover:bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p
                          className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                            isSelected ? 'text-white/40' : 'text-gray-400'
                          }`}
                        >
                          {template.chip}
                        </p>
                        <h3 className="mt-2 text-xl font-black tracking-tight">
                          {template.name}
                        </h3>
                        <p
                          className={`mt-2 text-sm leading-6 ${
                            isSelected ? 'text-white/70' : 'text-gray-500'
                          }`}
                        >
                          {template.description}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          isSelected
                            ? 'bg-white/10 text-amber-300'
                            : 'bg-[#f7f4ed] text-gray-500'
                        }`}
                      >
                        {template.paymentTerms}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          isSelected
                            ? 'bg-white/10 text-white/75'
                            : 'bg-[#f7f4ed] text-gray-600'
                        }`}
                      >
                        {template.costCenter}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          isSelected
                            ? 'bg-white/10 text-white/75'
                            : 'bg-[#f7f4ed] text-gray-600'
                        }`}
                      >
                        {template.project}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Template Identity
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Template name
                    </span>
                    <input
                      value={templateDraft.name}
                      onChange={(event) =>
                        updateTemplateField('name', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Category chip
                    </span>
                    <input
                      value={templateDraft.chip}
                      onChange={(event) =>
                        updateTemplateField('chip', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                </div>

                <label className="mt-4 block space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                    Description
                  </span>
                  <textarea
                    rows={3}
                    value={templateDraft.description}
                    onChange={(event) =>
                      updateTemplateField('description', event.target.value)
                    }
                    className="w-full resize-none rounded-[1.6rem] bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                  />
                </label>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Brand And Parties
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Company logo mark
                    </span>
                    <input
                      value={templateDraft.companyLogoLabel}
                      onChange={(event) =>
                        updateTemplateField('companyLogoLabel', event.target.value)
                      }
                      placeholder="LA"
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Company name
                    </span>
                    <input
                      value={templateDraft.companyName}
                      onChange={(event) =>
                        updateTemplateField('companyName', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Company address
                    </span>
                    <textarea
                      rows={4}
                      value={templateDraft.companyAddress}
                      onChange={(event) =>
                        updateTemplateField('companyAddress', event.target.value)
                      }
                      className="w-full resize-none rounded-[1.6rem] bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Client name
                    </span>
                    <input
                      value={templateDraft.clientName}
                      onChange={(event) =>
                        updateTemplateField('clientName', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                    <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
                      Client address
                    </span>
                    <textarea
                      rows={4}
                      value={templateDraft.clientAddress}
                      onChange={(event) =>
                        updateTemplateField('clientAddress', event.target.value)
                      }
                      className="w-full resize-none rounded-[1.6rem] bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Invoice Metadata
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Invoice number
                    </span>
                    <input
                      value={templateDraft.invoiceNumber}
                      onChange={(event) =>
                        updateTemplateField('invoiceNumber', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Issue date
                    </span>
                    <input
                      type="date"
                      value={templateDraft.issueDate}
                      onChange={(event) =>
                        updateTemplateField('issueDate', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Due date
                    </span>
                    <input
                      type="date"
                      value={templateDraft.dueDate}
                      onChange={(event) =>
                        updateTemplateField('dueDate', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Payment terms
                    </span>
                    <input
                      value={templateDraft.paymentTerms}
                      onChange={(event) =>
                        updateTemplateField('paymentTerms', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Cost center
                    </span>
                    <input
                      value={templateDraft.costCenter}
                      onChange={(event) =>
                        updateTemplateField('costCenter', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Project
                    </span>
                    <input
                      value={templateDraft.project}
                      onChange={(event) =>
                        updateTemplateField('project', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Invoice Body
                    </p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                      Item, quantity, units, days, rate, and totals
                    </h3>
                  </div>
                  <button
                    onClick={addTemplateLine}
                    className="rounded-full bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 transition hover:bg-gray-900 hover:text-white"
                  >
                    Add line
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {templateDraft.lineItems.map((line) => (
                    <div key={line.id} className="rounded-[1.7rem] bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <input
                          value={line.item}
                          onChange={(event) =>
                            updateTemplateLine(line.id, 'item', event.target.value)
                          }
                          className="min-w-0 flex-1 bg-transparent text-base font-black text-gray-900 outline-none"
                        />
                        <button
                          onClick={() => removeTemplateLine(line.id)}
                          className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400 transition hover:text-rose-600"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <label className="space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Quantity
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={line.quantity}
                            onChange={(event) =>
                              updateTemplateLine(
                                line.id,
                                'quantity',
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl bg-[#f7f4ed] px-4 py-3 text-sm font-medium text-gray-700 outline-none"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            No. of units
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={line.units}
                            onChange={(event) =>
                              updateTemplateLine(
                                line.id,
                                'units',
                                event.target.value,
                              )
                            }
                            className="w-full rounded-2xl bg-[#f7f4ed] px-4 py-3 text-sm font-medium text-gray-700 outline-none"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Number of days
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={line.days}
                            onChange={(event) =>
                              updateTemplateLine(line.id, 'days', event.target.value)
                            }
                            className="w-full rounded-2xl bg-[#f7f4ed] px-4 py-3 text-sm font-medium text-gray-700 outline-none"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Rate
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={line.rate}
                            onChange={(event) =>
                              updateTemplateLine(line.id, 'rate', event.target.value)
                            }
                            className="w-full rounded-2xl bg-[#f7f4ed] px-4 py-3 text-sm font-medium text-gray-700 outline-none"
                          />
                        </label>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            Total amount
                          </span>
                          <div className="flex h-[50px] items-center justify-end rounded-2xl bg-[#111827] px-4 text-sm font-black text-white">
                            {formatCurrency(getTemplateLineTotal(line))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Other Items
                    </p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                      Add extra sections to the invoice
                    </h3>
                  </div>
                  <button
                    onClick={addExtraSection}
                    className="rounded-full bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-gray-600 transition hover:bg-gray-900 hover:text-white"
                  >
                    Add section
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {templateDraft.extraSections.map((section) => (
                    <div
                      key={section.id}
                      className="rounded-[1.7rem] bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <input
                          value={section.title}
                          onChange={(event) =>
                            updateExtraSection(
                              section.id,
                              'title',
                              event.target.value,
                            )
                          }
                          className="min-w-0 flex-1 bg-transparent text-base font-black text-gray-900 outline-none"
                        />
                        <button
                          onClick={() => removeExtraSection(section.id)}
                          className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400 transition hover:text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        rows={4}
                        value={section.content}
                        onChange={(event) =>
                          updateExtraSection(
                            section.id,
                            'content',
                            event.target.value,
                          )
                        }
                        className="mt-4 w-full resize-none rounded-[1.4rem] bg-[#f7f4ed] px-4 py-3 text-sm font-medium text-gray-700 outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Tax label
                    </span>
                    <input
                      value={templateDraft.taxLabel}
                      onChange={(event) =>
                        updateTemplateField('taxLabel', event.target.value)
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Tax rate %
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={templateDraft.taxRate}
                      onChange={(event) =>
                        updateTemplateField(
                          'taxRate',
                          Number(event.target.value) || 0,
                        )
                      }
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                    />
                  </label>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.6rem] bg-white p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Subtotal
                    </p>
                    <p className="mt-2 text-2xl font-black text-gray-950">
                      {formatCurrency(templateSubtotal)}
                    </p>
                  </div>
                  <div className="rounded-[1.6rem] bg-white p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      {templateDraft.taxLabel}
                    </p>
                    <p className="mt-2 text-2xl font-black text-gray-950">
                      {formatCurrency(templateTaxAmount)}
                    </p>
                  </div>
                  <div className="rounded-[1.6rem] bg-[#111827] p-4 text-white">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
                      Grand total
                    </p>
                    <p className="mt-2 text-2xl font-black">
                      {formatCurrency(templateGrandTotal)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-[#fcfbf8] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                  Terms And Notes
                </p>
                <label className="mt-4 block space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                    Terms and conditions
                  </span>
                  <textarea
                    rows={5}
                    value={templateDraft.terms}
                    onChange={(event) =>
                      updateTemplateField('terms', event.target.value)
                    }
                    className="w-full resize-none rounded-[1.6rem] bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                  />
                </label>
                <label className="mt-4 block space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                    Notes
                  </span>
                  <textarea
                    rows={5}
                    value={templateDraft.notes}
                    onChange={(event) =>
                      updateTemplateField('notes', event.target.value)
                    }
                    className="w-full resize-none rounded-[1.6rem] bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none ring-1 ring-gray-100 transition focus:ring-2 focus:ring-amber-300"
                  />
                </label>
              </div>

              <div className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                      Live Preview
                    </p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-gray-950">
                      Invoice template canvas
                    </h3>
                  </div>
                  <span className="rounded-full bg-[#f7f4ed] px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
                    editable preview
                  </span>
                </div>

                <div className="mt-5 rounded-[2rem] border border-[#e7dfd0] bg-[#fffdf9] p-6">
                  <div className="flex flex-col gap-6 border-b border-[#e9e0d3] pb-6 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-[#111827] text-lg font-black text-amber-300">
                        {getInitials(
                          templateDraft.companyLogoLabel ||
                            templateDraft.companyName,
                        )}
                      </div>
                      <div>
                        <h4 className="text-2xl font-black tracking-tight text-gray-950">
                          {templateDraft.companyName}
                        </h4>
                        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">
                          {templateDraft.companyAddress}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] bg-[#f7f4ed] px-5 py-4 md:min-w-[260px]">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Invoice
                      </p>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-bold text-gray-500">Number</span>
                          <span className="font-black text-gray-950">
                            {templateDraft.invoiceNumber}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-bold text-gray-500">Issue date</span>
                          <span className="font-black text-gray-950">
                            {templateDraft.issueDate}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-bold text-gray-500">Due date</span>
                          <span className="font-black text-gray-950">
                            {templateDraft.dueDate}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-bold text-gray-500">Terms</span>
                          <span className="font-black text-gray-950">
                            {templateDraft.paymentTerms}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-[1.6rem] bg-[#f7f4ed] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Bill from
                      </p>
                      <p className="mt-2 text-sm font-black text-gray-950">
                        {templateDraft.companyName}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">
                        {templateDraft.companyAddress}
                      </p>
                    </div>
                    <div className="rounded-[1.6rem] bg-[#f7f4ed] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                        Bill to
                      </p>
                      <p className="mt-2 text-sm font-black text-gray-950">
                        {templateDraft.clientName}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">
                        {templateDraft.clientAddress}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 overflow-hidden rounded-[1.6rem] border border-[#e7dfd0]">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-[#111827] text-white">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Item
                          </th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Qty
                          </th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Units
                          </th>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Days
                          </th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Rate
                          </th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                            Total amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4d8] bg-white">
                        {templateDraft.lineItems.map((line) => (
                          <tr key={line.id}>
                            <td className="px-4 py-4 text-sm font-black text-gray-900">
                              {line.item}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600">
                              {line.quantity}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600">
                              {line.units}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600">
                              {line.days}
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-gray-600">
                              {formatCurrency(line.rate)}
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-black text-gray-950">
                              {formatCurrency(getTemplateLineTotal(line))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_280px]">
                    <div className="space-y-4">
                      {templateDraft.extraSections.map((section) => (
                        <div
                          key={section.id}
                          className="rounded-[1.6rem] bg-[#f7f4ed] p-4"
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                            {section.title}
                          </p>
                          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">
                            {section.content}
                          </p>
                        </div>
                      ))}

                      <div className="rounded-[1.6rem] bg-[#f7f4ed] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                          Terms and conditions
                        </p>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          {templateDraft.terms}
                        </p>
                      </div>

                      <div className="rounded-[1.6rem] bg-[#f7f4ed] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                          Notes
                        </p>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          {templateDraft.notes}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[1.8rem] bg-[#111827] p-5 text-white">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
                        Summary
                      </p>
                      <div className="mt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-white/60">Cost center</span>
                          <span className="font-black">{templateDraft.costCenter}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-white/60">Project</span>
                          <span className="text-right font-black">
                            {templateDraft.project}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-white/60">Subtotal</span>
                          <span className="font-black">
                            {formatCurrency(templateSubtotal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-white/60">
                            {templateDraft.taxLabel} ({templateDraft.taxRate}%)
                          </span>
                          <span className="font-black">
                            {formatCurrency(templateTaxAmount)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3">
                          <span className="text-white/60">Grand total</span>
                          <span className="text-lg font-black">
                            {formatCurrency(templateGrandTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
