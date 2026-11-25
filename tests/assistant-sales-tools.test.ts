import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const lib = vi.hoisted(() => ({
  // clients
  createCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  getCustomerById: vi.fn(),
  // crm
  listCrmCustomers: vi.fn(),
  listCrmActivities: vi.fn(),
  listDeals: vi.fn(),
  listQuoteOptions: vi.fn(),
  listContractOptions: vi.fn(),
  createDeal: vi.fn(),
  updateDeal: vi.fn(),
  deleteDeal: vi.fn(),
  createActivity: vi.fn(),
  updateCrmCustomer: vi.fn(),
  // quotes
  listQuotesForUser: vi.fn(),
  getQuoteForUser: vi.fn(),
  listApproverCandidates: vi.fn(),
  createQuote: vi.fn(),
  updateDraftQuote: vi.fn(),
  submitQuote: vi.fn(),
  decideQuote: vi.fn(),
  markQuoteSent: vi.fn(),
  duplicateQuote: vi.fn(),
  deleteQuote: vi.fn(),
  // invoices
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  createInvoiceFromQuote: vi.fn(),
  listInvoiceableQuotes: vi.fn(),
  listInvoiceApproverCandidates: vi.fn(),
  submitInvoiceForApproval: vi.fn(),
  decideInvoice: vi.fn(),
  recordInvoicePayment: vi.fn(),
  sendInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  // products
  listProducts: vi.fn(),
  getProductById: vi.fn(),
  findProductWithSku: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  // the rest
  recordAuditEvent: vi.fn(),
  isEmailConfigured: vi.fn(),
  emailQuoteToCustomer: vi.fn(),
  emailInvoiceToCustomer: vi.fn(),
  emailInvoiceApprovalRequest: vi.fn(),
  emailInvoiceDecisionToCreator: vi.fn(),
  getOrganizationSettings: vi.fn(),
  listBrandProfiles: vi.fn(),
  customerFindUnique: vi.fn(),
  invoiceItemFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('../lib/customers', () => ({
  createCustomer: lib.createCustomer,
  deleteCustomer: lib.deleteCustomer,
  getCustomerById: lib.getCustomerById,
}));
vi.mock('../lib/crm', () => ({
  CUSTOMER_ENTITIES: ['LADYASKARI', 'LIONESS', 'STARLLWART'],
  DEFAULT_ENTITY: 'LADYASKARI',
  DEAL_STAGE_KEYS: ['lead', 'onboarding', 'proposal', 'won', 'execution', 'invoiced', 'closed', 'lost'],
  SIGNATURE_STATUSES: ['none', 'sent', 'signed', 'declined'],
  ACTIVITY_TYPES: ['call', 'email', 'meeting', 'note'],
  listCrmCustomers: lib.listCrmCustomers,
  listCrmActivities: lib.listCrmActivities,
  listDeals: lib.listDeals,
  listQuoteOptions: lib.listQuoteOptions,
  listContractOptions: lib.listContractOptions,
  createDeal: lib.createDeal,
  updateDeal: lib.updateDeal,
  deleteDeal: lib.deleteDeal,
  createActivity: lib.createActivity,
  updateCrmCustomer: lib.updateCrmCustomer,
}));
vi.mock('../lib/quotes', () => ({
  QUOTE_STATUSES: ['Draft', 'Submitted', 'Approved', 'Declined', 'Sent', 'Expired'],
  listQuotesForUser: lib.listQuotesForUser,
  getQuoteForUser: lib.getQuoteForUser,
  listApproverCandidates: lib.listApproverCandidates,
  createQuote: lib.createQuote,
  updateDraftQuote: lib.updateDraftQuote,
  submitQuote: lib.submitQuote,
  decideQuote: lib.decideQuote,
  markQuoteSent: lib.markQuoteSent,
  duplicateQuote: lib.duplicateQuote,
  deleteQuote: lib.deleteQuote,
}));
vi.mock('../lib/invoices', () => ({
  INVOICE_STATUSES: ['Draft', 'Pending Approval', 'Approved', 'Declined', 'Sent', 'Partial', 'Paid', 'Void'],
  PAYMENT_METHODS: ['Bank transfer', 'Mobile money', 'Cash', 'Card', 'Cheque', 'Other'],
  listInvoices: lib.listInvoices,
  getInvoice: lib.getInvoice,
  createInvoice: lib.createInvoice,
  updateInvoice: lib.updateInvoice,
  createInvoiceFromQuote: lib.createInvoiceFromQuote,
  listInvoiceableQuotes: lib.listInvoiceableQuotes,
  listInvoiceApproverCandidates: lib.listInvoiceApproverCandidates,
  submitInvoiceForApproval: lib.submitInvoiceForApproval,
  decideInvoice: lib.decideInvoice,
  recordInvoicePayment: lib.recordInvoicePayment,
  sendInvoice: lib.sendInvoice,
  voidInvoice: lib.voidInvoice,
  deleteInvoice: lib.deleteInvoice,
}));
vi.mock('../lib/products', () => ({
  SERVICE_DETAIL_KEYS: ['category', 'country', 'unitOfMeasure'],
  listProducts: lib.listProducts,
  getProductById: lib.getProductById,
  findProductWithSku: lib.findProductWithSku,
  createProduct: lib.createProduct,
  updateProduct: lib.updateProduct,
  deleteProduct: lib.deleteProduct,
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent: lib.recordAuditEvent }));
vi.mock('../lib/email', () => {
  class EmailError extends Error {}
  return { EmailError, isEmailConfigured: lib.isEmailConfigured };
});
vi.mock('../lib/transactional-email', () => ({
  emailQuoteToCustomer: lib.emailQuoteToCustomer,
  emailInvoiceToCustomer: lib.emailInvoiceToCustomer,
  emailInvoiceApprovalRequest: lib.emailInvoiceApprovalRequest,
  emailInvoiceDecisionToCreator: lib.emailInvoiceDecisionToCreator,
}));
vi.mock('../lib/organization', () => ({ getOrganizationSettings: lib.getOrganizationSettings }));
vi.mock('../lib/brand-profiles', () => ({ listBrandProfiles: lib.listBrandProfiles }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    customer: { findUnique: lib.customerFindUnique },
    invoiceItem: { findMany: lib.invoiceItemFindMany },
    invoice: { findFirst: lib.invoiceFindFirst, findMany: lib.invoiceFindMany },
    user: { findMany: lib.userFindMany },
  },
}));
// Each test user row carries its own roles and modules, as `buildAccessUser` would produce them.
vi.mock('../lib/user', () => ({
  userAccessInclude: {},
  buildAccessUser: (row: unknown) => row,
  userHasRole: (user: { roles: Array<{ name: string }> }, name: string) => user.roles.some((role) => role.name === name),
  userHasModule: (user: { modules: Array<{ slug: string }> }, slug: string) => user.modules.some((module) => module.slug === slug),
}));

import { executeTool } from '../lib/assistant/execute';
import { crmTools } from '../lib/assistant/tools/crm';
import { customerTools } from '../lib/assistant/tools/customers';
import { invoiceTools } from '../lib/assistant/tools/invoices';
import { productTools } from '../lib/assistant/tools/products';
import { quoteTools } from '../lib/assistant/tools/quotes';
import type { JsonSchema, ToolContext } from '../lib/assistant/types';
import { API_ACCESS } from '../lib/api-access';

const tools = [...customerTools, ...crmTools, ...quoteTools, ...invoiceTools, ...productTools];

function context(overrides: { isAdmin?: boolean; modules?: string[] } = {}): ToolContext {
  return {
    userId: 7,
    userName: 'Amina',
    isAdmin: overrides.isAdmin ?? false,
    user: { id: 7, name: 'Amina', roles: [], modules: (overrides.modules ?? []).map((slug) => ({ slug })) },
    timeZone: 'Africa/Nairobi',
    request: {},
  } as unknown as ToolContext;
}

const tool = (name: string) => tools.find((t) => t.functionDeclaration.name === name)!;
const run = (name: string, args: Record<string, unknown>, ctx: ToolContext = context()) => executeTool(tool(name), args, ctx);
const errorOf = (action: { result: unknown }) => (action.result as { error?: string }).error ?? '';
const audited = () => lib.recordAuditEvent.mock.calls.map(([event]) => event.action);

// --- Fixtures ------------------------------------------------------------------------

const transfer = {
  id: 301,
  position: 0,
  description: 'Airport transfer',
  quantity: 2,
  days: 3,
  unitPrice: 150,
  taxable: true,
  discountType: 'percentage',
  discountValue: 10,
  discountAmount: 90,
  total: 810,
  productId: 44,
};
const escort = {
  id: 302,
  position: 1,
  description: 'Close protection officer',
  quantity: 1,
  days: 1,
  unitPrice: 400,
  taxable: false,
  discountType: 'none',
  discountValue: 0,
  discountAmount: 0,
  total: 400,
  productId: null,
};

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    reference: 'QT-2026-0012',
    trackingCode: null,
    subject: 'Nairobi arrival',
    status: 'Draft',
    issueDate: '2026-11-20T00:00:00.000Z',
    expiryDate: '2026-12-20T00:00:00.000Z',
    currency: 'USD',
    taxRate: 0.16,
    discountType: 'fixed',
    discountValue: 50,
    discountAmount: 50,
    subtotal: 1210,
    tax: 129.6,
    total: 1289.6,
    notes: null,
    terms: null,
    decisionNote: null,
    customer: { id: 3, name: 'Bridge Corp', company: null, email: 'ops@bridge.example' },
    createdBy: { id: 7, name: 'Amina', email: 'a@x' },
    approver: null,
    brandProfile: null,
    itemCount: 2,
    trip: null,
    items: [transfer, escort],
    ...overrides,
  };
}

const invoiceLine = { id: 501, position: 0, description: 'Security detail', quantity: 4, unitPrice: 250, taxable: true, total: 900, productId: 44 };
const invoiceLine2 = { id: 502, position: 1, description: 'Fuel', quantity: 1, unitPrice: 80, taxable: true, total: 80, productId: null };

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 40,
    number: 'INV-2026-0040',
    status: 'Approved',
    isOverdue: false,
    issueDate: '2026-11-01T00:00:00.000Z',
    dueDate: '2026-11-15T00:00:00.000Z',
    currency: 'USD',
    taxRate: 0,
    discountType: 'none',
    discountValue: 0,
    discountAmount: 0,
    subtotal: 980,
    tax: 0,
    total: 980,
    amountPaid: 0,
    balanceDue: 980,
    notes: null,
    terms: null,
    sentAt: null,
    decisionNote: null,
    customer: { id: 3, name: 'Bridge Corp', company: null, email: 'ops@bridge.example' },
    createdBy: { id: 8, name: 'Brian', email: 'b@x' },
    approver: null,
    brandProfile: null,
    sourceQuote: null,
    itemCount: 2,
    items: [invoiceLine, invoiceLine2],
    payments: [],
    ...overrides,
  };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Bridge Corp',
    email: 'ops@bridge.example',
    phone: '+254 700 000001',
    company: null,
    address: null,
    billingAddress: null,
    entity: 'LADYASKARI',
    contacts: [{ id: 60, name: 'J. Doe', role: 'Travel desk', email: 'j@bridge.example', phone: '+254 700 000002' }],
    dealCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: 90,
    title: 'Annual retainer',
    stage: 'proposal',
    value: 5000,
    currency: 'USD',
    customer: { id: 3, name: 'Bridge Corp', entity: 'LADYASKARI' },
    quote: null,
    contract: null,
    signatureStatus: 'none',
    expectedCloseDate: '2026-12-15T00:00:00.000Z',
    lostReason: null,
    notes: null,
    stageChangedAt: '2026-11-01T00:00:00.000Z',
    daysInStage: 23,
    isOutstanding: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    name: 'Airport transfer',
    description: null,
    sku: 'TRF-NBO',
    defaultUnitPrice: 150,
    currency: 'USD',
    taxable: true,
    archived: false,
    category: 'Transport',
    country: 'Kenya',
    unitOfMeasure: 'per trip',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
  lib.recordAuditEvent.mockResolvedValue(undefined);
  lib.isEmailConfigured.mockReturnValue(true);
  lib.getOrganizationSettings.mockResolvedValue({ defaultCurrency: 'KES', defaultTaxRate: 0.16 });
  lib.listBrandProfiles.mockResolvedValue([{ id: 5, isDefault: false }, { id: 2, isDefault: true }]);
  lib.getCustomerById.mockResolvedValue({ id: 3, name: 'Bridge Corp' });
  lib.getProductById.mockResolvedValue(product());
  lib.listApproverCandidates.mockResolvedValue([{ id: 9, name: 'Grace', email: 'g@x' }]);
  lib.getQuoteForUser.mockResolvedValue(quote());
  lib.getInvoice.mockResolvedValue(invoice());
  lib.invoiceItemFindMany.mockResolvedValue([
    { id: 501, discountType: 'percentage', discountValue: '10' },
    { id: 502, discountType: 'none', discountValue: '0' },
  ]);
  lib.invoiceFindFirst.mockResolvedValue(null);
  lib.invoiceFindMany.mockResolvedValue([]);
  lib.listCrmCustomers.mockResolvedValue([client(), client({ id: 4, name: 'Zed Ltd', email: null, phone: null, contacts: [], dealCount: 0 })]);
  lib.listDeals.mockResolvedValue([deal()]);
  lib.listCrmActivities.mockResolvedValue([]);
  lib.listQuoteOptions.mockResolvedValue([]);
  lib.listContractOptions.mockResolvedValue([]);
});

// --- Invoices ------------------------------------------------------------------------

describe('send_invoice', () => {
  it('refuses a void invoice and emails nothing', async () => {
    lib.getInvoice.mockResolvedValue(invoice({ status: 'Void' }));
    const action = await run('send_invoice', { invoiceId: 40 });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('INV-2026-0040 is void and cannot be sent');
    expect(lib.emailInvoiceToCustomer).not.toHaveBeenCalled();
    expect(lib.sendInvoice).not.toHaveBeenCalled();
  });

  it.each(['Draft', 'Pending Approval', 'Declined'])('refuses an unapproved (%s) invoice and emails nothing', async (status) => {
    lib.getInvoice.mockResolvedValue(invoice({ status }));
    const action = await run('send_invoice', { invoiceId: 40 });
    expect(errorOf(action)).toContain('must be approved before it can be sent');
    expect(lib.emailInvoiceToCustomer).not.toHaveBeenCalled();
    expect(lib.sendInvoice).not.toHaveBeenCalled();
  });

  it('refuses when email is not configured and does not mark it Sent', async () => {
    lib.isEmailConfigured.mockReturnValue(false);
    const action = await run('send_invoice', { invoiceId: 40 });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('Email is not set up yet');
    expect(lib.emailInvoiceToCustomer).not.toHaveBeenCalled();
    expect(lib.sendInvoice).not.toHaveBeenCalled();
  });

  it('refuses when the client has no address and does not mark it Sent', async () => {
    lib.getInvoice.mockResolvedValue(invoice({ customer: { id: 3, name: 'Bridge Corp', company: null, email: null } }));
    const action = await run('send_invoice', { invoiceId: 40 });
    expect(errorOf(action)).toContain('Bridge Corp has no email address on file');
    expect(lib.emailInvoiceToCustomer).not.toHaveBeenCalled();
    expect(lib.sendInvoice).not.toHaveBeenCalled();
  });

  it('does not mark it Sent when delivery fails', async () => {
    lib.emailInvoiceToCustomer.mockRejectedValue(new Error('smtp timeout'));
    const action = await run('send_invoice', { invoiceId: 40 });
    expect(errorOf(action)).toContain('The invoice was not marked Sent');
    expect(lib.sendInvoice).not.toHaveBeenCalled();
  });

  it('delivers first, then marks it Sent, and logs it as the page does', async () => {
    const order: string[] = [];
    lib.emailInvoiceToCustomer.mockImplementation(async () => {
      order.push('email');
      return { to: 'ops@bridge.example' };
    });
    lib.sendInvoice.mockImplementation(async () => {
      order.push('mark');
      return invoice({ status: 'Sent' });
    });
    const action = await run('send_invoice', { invoiceId: 40, number: 'INV-2026-0040' });
    expect(order).toEqual(['email', 'mark']);
    expect(action.result).toMatchObject({ status: 'Sent', emailedTo: 'ops@bridge.example' });
    expect(action.summary).toBe('Emailed invoice INV-2026-0040 to ops@bridge.example and marked it Sent');
    expect(action.href).toBe('/modules/invoices-review?open=40');
    expect(lib.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invoice.sent', entityType: 'invoice', metadata: expect.objectContaining({ via: 'assistant' }) }),
    );
    expect(tool('send_invoice').destructive).toBe(true);
  });

  it('refuses when the Confirm card named a different invoice', async () => {
    const action = await run('send_invoice', { invoiceId: 40, number: 'INV-2026-0041' });
    expect(errorOf(action)).toContain('Invoice 40 is INV-2026-0040, not INV-2026-0041');
    expect(lib.emailInvoiceToCustomer).not.toHaveBeenCalled();
  });
});

describe('invoice lines', () => {
  it('update_invoice refuses an empty items list and deletes nothing', async () => {
    const action = await run('update_invoice', { invoiceId: 40, items: [] });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('items cannot be empty: an invoice needs at least one line');
    expect(lib.updateInvoice).not.toHaveBeenCalled();
  });

  it('create_invoice lines carry no days: the schema does not offer it and a call with it is refused', async () => {
    for (const name of ['create_invoice', 'update_invoice', 'add_invoice_line', 'update_invoice_line']) {
      const properties = tool(name).functionDeclaration.parameters.properties!;
      expect(Object.keys((properties.items as JsonSchema | undefined)?.items?.properties ?? properties)).not.toContain('days');
    }
    const refused = await run('create_invoice', { customerId: 3, items: [{ description: 'Security detail', quantity: 2, days: 3, unitPrice: 250 }] });
    expect(errorOf(refused)).toContain('items[1].days is not something this tool can set');
    expect(lib.createInvoice).not.toHaveBeenCalled();

    lib.createInvoice.mockResolvedValue(invoice({ status: 'Draft' }));
    const created = await run('create_invoice', { customerId: 3, items: [{ description: 'Security detail', quantity: 6, unitPrice: 250, productId: 44 }] });
    expect(created.ok).toBe(true);
    const sent = lib.createInvoice.mock.calls[0][0];
    expect(sent.items).toEqual([{ description: 'Security detail', quantity: 6, unitPrice: 250, productId: 44 }]);
    expect(sent.items[0]).not.toHaveProperty('days');
  });

  it('create_invoice starts as the builder does: default company, currency and tax rate, due 14 days on', async () => {
    lib.createInvoice.mockResolvedValue(invoice({ status: 'Draft' }));
    await run('create_invoice', { customerId: 3, issueDate: '2026-11-24', items: [{ description: 'Fuel', quantity: 1, unitPrice: 80 }] });
    expect(lib.createInvoice.mock.calls[0][0]).toMatchObject({
      customerId: 3,
      brandProfileId: 2,
      currency: 'KES',
      taxRate: 0.16,
      issueDate: '2026-11-24',
      dueDate: '2026-12-08',
      createdById: 7,
    });
    expect(audited()).toEqual(['invoice.created']);
  });

  it('create_invoice checks the client first and refuses a due date before the issue date', async () => {
    lib.getCustomerById.mockResolvedValue(null);
    const items = [{ description: 'Fuel', quantity: 1, unitPrice: 80 }];
    expect(errorOf(await run('create_invoice', { customerId: 99, items }))).toContain('Client 99 was not found');
    expect(errorOf(await run('create_invoice', { customerId: 3, items, issueDate: '2026-11-24', dueDate: '2026-11-01' }))).toContain(
      'dueDate (2026-11-01) is before issueDate (2026-11-24)',
    );
    expect(lib.createInvoice).not.toHaveBeenCalled();
  });

  it('add_invoice_line keeps the existing lines and their discounts', async () => {
    lib.getInvoice.mockResolvedValue(invoice({ status: 'Draft' }));
    lib.updateInvoice.mockResolvedValue(invoice({ status: 'Draft', total: 1040 }));
    const action = await run('add_invoice_line', { invoiceId: 40, description: 'Parking', quantity: 2, unitPrice: 30 });
    expect(action.ok).toBe(true);
    expect(lib.updateInvoice.mock.calls[0][0]).toEqual({
      id: 40,
      input: {
        items: [
          { description: 'Security detail', quantity: 4, unitPrice: 250, taxable: true, discountType: 'percentage', discountValue: 10, productId: 44 },
          { description: 'Fuel', quantity: 1, unitPrice: 80, taxable: true, discountType: 'none', discountValue: 0, productId: null },
          { description: 'Parking', quantity: 2, unitPrice: 30 },
        ],
      },
    });
  });

  it('update_invoice only sends what was given, so currency and discount are not reset', async () => {
    lib.getInvoice.mockResolvedValue(invoice({ status: 'Draft' }));
    lib.updateInvoice.mockResolvedValue(invoice({ status: 'Draft', dueDate: '2026-12-01T00:00:00.000Z' }));
    const action = await run('update_invoice', { invoiceId: 40, dueDate: '2026-12-01' });
    expect(lib.updateInvoice.mock.calls[0][0].input).toEqual({ dueDate: '2026-12-01' });
    expect(action.result).toMatchObject({ changed: { dueDate: { from: '2026-11-15', to: '2026-12-01' } } });
    expect(action.summary).toBe('Updated invoice INV-2026-0040: dueDate');
  });
});

describe('record_invoice_payment', () => {
  it('is destructive, and its label names the amount, currency and invoice number', () => {
    const payment = tool('record_invoice_payment');
    expect(payment.destructive).toBe(true);
    expect(payment.confirmLabel!({ invoiceId: 40, amount: 500, currency: 'usd', number: 'INV-2026-0040', paidAt: '2026-11-20' })).toBe(
      'Record a payment of USD 500 on invoice INV-2026-0040, dated 2026-11-20 (cannot be undone here)',
    );
  });

  it('takes paidAt, note and a listed method, and returns the QuickBooks result', async () => {
    lib.recordInvoicePayment.mockResolvedValue({
      ...invoice({ status: 'Partial', amountPaid: 500, balanceDue: 480 }),
      quickbooks: { status: 'failed', error: 'token expired' },
    });
    const action = await run('record_invoice_payment', {
      invoiceId: 40,
      amount: 500,
      paidAt: '2026-11-20',
      method: 'Mobile money',
      reference: 'QK12AB',
      note: 'Deposit',
    });
    expect(lib.recordInvoicePayment).toHaveBeenCalledWith({
      invoiceId: 40,
      userId: 7,
      input: { amount: 500, method: 'Mobile money', reference: 'QK12AB', note: 'Deposit', paidAt: '2026-11-20' },
    });
    expect(action.result).toMatchObject({
      status: 'Partial',
      balanceDue: 480,
      payment: { amount: 500, paidAt: '2026-11-20' },
      quickbooks: { status: 'failed', error: 'token expired' },
    });
    expect(audited()).toEqual(['invoice.payment.recorded']);
  });

  it("dates the payment today in the user's zone when no date is given", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T22:30:00.000Z') });
    lib.recordInvoicePayment.mockResolvedValue(invoice({ status: 'Paid', amountPaid: 980, balanceDue: 0 }));
    await run('record_invoice_payment', { invoiceId: 40, amount: 980 });
    vi.useRealTimers();
    // 01:30 on the 25th in Nairobi, though still the 24th in UTC.
    expect(lib.recordInvoicePayment.mock.calls[0][0].input).toMatchObject({ paidAt: '2026-11-25', method: 'Bank transfer' });
  });

  it.each([0, -50])('refuses a non-positive amount (%s)', async (amount) => {
    const action = await run('record_invoice_payment', { invoiceId: 40, amount });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toMatch(/amount (must be more than zero|cannot be less than 0)/);
    expect(lib.recordInvoicePayment).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: '5k' }, 'amount must be a number'],
    [{ amount: 100, paidAt: '20 Nov 2026' }, 'paidAt must be a real date'],
    [{ amount: 100, method: 'Bitcoin' }, 'method must be one of'],
    [{ amount: 100, currency: 'KES' }, 'INV-2026-0040 is in USD, not KES'],
  ])('refuses %j', async (extra, message) => {
    const action = await run('record_invoice_payment', { invoiceId: 40, ...extra });
    expect(errorOf(action)).toContain(message);
    expect(lib.recordInvoicePayment).not.toHaveBeenCalled();
  });
});

describe('create_invoice_from_quote', () => {
  it.each(['Draft', 'Declined', 'Submitted'])('refuses a %s quote', async (status) => {
    lib.listInvoiceableQuotes.mockResolvedValue([]);
    lib.getQuoteForUser.mockResolvedValue(quote({ status }));
    const action = await run('create_invoice_from_quote', { quoteId: 12 });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(`QT-2026-0012 is ${status}. Only an Approved or Sent quote can be invoiced`);
    expect(lib.createInvoiceFromQuote).not.toHaveBeenCalled();
  });

  it('refuses a quote that is not offered for invoicing and that this user cannot see', async () => {
    lib.listInvoiceableQuotes.mockResolvedValue([]);
    lib.getQuoteForUser.mockResolvedValue(null);
    expect(errorOf(await run('create_invoice_from_quote', { quoteId: 12 }))).toContain('Quote 12 is not one that can be invoiced');
    expect(lib.createInvoiceFromQuote).not.toHaveBeenCalled();
  });

  it('refuses a quote that was already invoiced', async () => {
    lib.listInvoiceableQuotes.mockResolvedValue([{ id: 12, reference: 'QT-2026-0012', subject: 'Nairobi arrival', customer: 'Bridge Corp', total: 1289.6, currency: 'USD' }]);
    lib.invoiceFindFirst.mockResolvedValue({ id: 40, number: 'INV-2026-0040', status: 'Sent' });
    const action = await run('create_invoice_from_quote', { quoteId: 12 });
    expect(errorOf(action)).toContain('QT-2026-0012 was already invoiced as INV-2026-0040');
    expect(lib.invoiceFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceQuoteId: 12, status: { not: 'Void' } } }));
    expect(lib.createInvoiceFromQuote).not.toHaveBeenCalled();
  });

  it('invoices an approved quote once, and keeps dueInDays within 0 to 365', async () => {
    lib.listInvoiceableQuotes.mockResolvedValue([{ id: 12, reference: 'QT-2026-0012', subject: 'Nairobi arrival', customer: 'Bridge Corp', total: 1289.6, currency: 'USD' }]);
    expect(errorOf(await run('create_invoice_from_quote', { quoteId: 12, dueInDays: 400 }))).toContain('dueInDays cannot be more than 365');
    expect(lib.createInvoiceFromQuote).not.toHaveBeenCalled();

    lib.createInvoiceFromQuote.mockResolvedValue(invoice({ status: 'Draft', sourceQuote: { id: 12, reference: 'QT-2026-0012' } }));
    const action = await run('create_invoice_from_quote', { quoteId: 12, dueInDays: 30 });
    expect(lib.createInvoiceFromQuote).toHaveBeenCalledWith({ quoteId: 12, userId: 7, dueInDays: 30 });
    expect(action.summary).toContain('Created invoice INV-2026-0040 from quote QT-2026-0012');
  });

  it('list_invoiceable_quotes shows which are already invoiced', async () => {
    lib.listInvoiceableQuotes.mockResolvedValue([
      { id: 12, reference: 'QT-2026-0012', subject: 'Nairobi arrival', customer: 'Bridge Corp', total: 1289.6, currency: 'USD' },
      { id: 13, reference: 'QT-2026-0013', subject: 'Kampala', customer: 'Zed Ltd', total: 10, currency: 'USD' },
    ]);
    lib.invoiceFindMany.mockResolvedValue([{ sourceQuoteId: 12, number: 'INV-2026-0040' }]);
    const action = await run('list_invoiceable_quotes', {});
    expect(action.result).toMatchObject({ total: 2, quotes: [{ quoteId: 12, invoicedAs: 'INV-2026-0040' }, { quoteId: 13 }] });
  });
});

describe('the rest of the invoice tools', () => {
  it('list_invoices filters by overdue, unpaid, status, client and search, and reports total and more', async () => {
    const rows = [
      invoice({ id: 1, number: 'INV-2026-0001', status: 'Sent', isOverdue: true, dueDate: '2026-11-10T00:00:00.000Z', balanceDue: 300 }),
      invoice({ id: 2, number: 'INV-2026-0002', status: 'Sent', isOverdue: true, dueDate: '2026-10-01T00:00:00.000Z', balanceDue: 200 }),
      invoice({ id: 3, number: 'INV-2026-0003', status: 'Paid', balanceDue: 0, customer: { id: 4, name: 'Zed Ltd', company: null, email: null } }),
      invoice({ id: 4, number: 'INV-2026-0004', status: 'Draft' }),
    ];
    lib.listInvoices.mockResolvedValue(rows);

    const overdue = await run('list_invoices', { overdue: true });
    expect(overdue.kind).toBe('read');
    expect(overdue.result).toMatchObject({
      total: 2,
      more: false,
      balanceDue: { USD: 500 },
      // Longest overdue first.
      invoices: [
        { id: 2, number: 'INV-2026-0002', overdue: true, dueDate: '2026-10-01', balanceDue: 200, currency: 'USD', issueDate: '2026-11-01' },
        { id: 1, dueDate: '2026-11-10' },
      ],
    });
    expect((await run('list_invoices', { status: 'Paid' })).result).toMatchObject({ total: 1, invoices: [{ id: 3 }] });
    expect((await run('list_invoices', { q: 'zed' })).result).toMatchObject({ total: 1, invoices: [{ id: 3 }] });
    expect((await run('list_invoices', { customerId: 4 })).result).toMatchObject({ total: 1 });
    expect((await run('list_invoices', { unpaid: true })).result).toMatchObject({ total: 2 });

    lib.listInvoices.mockResolvedValue(Array.from({ length: 45 }, (_, i) => invoice({ id: i + 1, number: `INV-2026-${i + 1}` })));
    expect((await run('list_invoices', {})).result).toMatchObject({ total: 45, page: 1, more: true });
    const last = (await run('list_invoices', { page: 3 })).result as { invoices: unknown[]; more: boolean };
    expect(last.invoices).toHaveLength(5);
    expect(last.more).toBe(false);
  });

  it('get_invoice returns the lines with their discounts, and the payments', async () => {
    lib.getInvoice.mockResolvedValue(
      invoice({ payments: [{ id: 1, amount: 100, method: 'Cash', reference: null, note: null, paidAt: '2026-11-10T00:00:00.000Z', recordedBy: { id: 8, name: 'Brian' } }] }),
    );
    const action = await run('get_invoice', { invoiceId: 40 });
    expect(action.result).toMatchObject({
      number: 'INV-2026-0040',
      dueDate: '2026-11-15',
      lines: [
        { lineId: 501, position: 1, description: 'Security detail', quantity: 4, unitPrice: 250, discount: '10%', total: 900, productId: 44 },
        { lineId: 502, position: 2, description: 'Fuel' },
      ],
      payments: [{ amount: 100, method: 'Cash', paidAt: '2026-11-10', recordedBy: 'Brian' }],
    });
  });

  it('void_invoice refuses a paid or already-void invoice', async () => {
    lib.getInvoice.mockResolvedValue(invoice({ status: 'Paid' }));
    expect(errorOf(await run('void_invoice', { invoiceId: 40 }))).toContain('paid in full; a paid invoice cannot be voided');
    lib.getInvoice.mockResolvedValue(invoice({ status: 'Void' }));
    expect(errorOf(await run('void_invoice', { invoiceId: 40 }))).toContain('already void');
    expect(lib.voidInvoice).not.toHaveBeenCalled();

    lib.getInvoice.mockResolvedValue(invoice({ status: 'Sent' }));
    lib.voidInvoice.mockResolvedValue(invoice({ status: 'Void' }));
    const action = await run('void_invoice', { invoiceId: 40 });
    expect(action.ok).toBe(true);
    expect(audited()).toEqual(['invoice.voided']);
    expect(tool('void_invoice').destructive).toBe(true);
  });

  it('decide_invoice says approve or decline and the number on its Confirm card', async () => {
    const decide = tool('decide_invoice');
    expect(decide.destructive).toBe(true);
    expect(decide.confirmLabel!({ invoiceId: 40, decision: 'approved', number: 'INV-2026-0040' })).toBe('Approve invoice INV-2026-0040');
    expect(decide.confirmLabel!({ invoiceId: 40, decision: 'declined', number: 'INV-2026-0040' })).toBe('Decline invoice INV-2026-0040');

    lib.isEmailConfigured.mockReturnValue(false);
    lib.decideInvoice.mockResolvedValue(invoice({ status: 'Declined' }));
    const action = await run('decide_invoice', { invoiceId: 40, decision: 'declined', note: 'Wrong rate' });
    expect(lib.decideInvoice).toHaveBeenCalledWith({ id: 40, userId: 7, isAdmin: false, decision: 'declined', note: 'Wrong rate' });
    expect(action.summary).toBe('Declined invoice INV-2026-0040');
    expect(audited()).toEqual(['invoice.declined']);
  });

  it('list_invoice_approvers keeps to people who hold Invoices or are admins', async () => {
    lib.listInvoiceApproverCandidates.mockResolvedValue([
      { id: 9, name: 'Grace', email: 'g@x' },
      { id: 10, name: 'Hamid', email: 'h@x' },
      { id: 11, name: 'Ivy', email: 'i@x' },
    ]);
    lib.userFindMany.mockResolvedValue([
      { id: 9, roles: [], modules: [{ slug: 'invoices-review' }] },
      { id: 10, roles: [], modules: [{ slug: 'quotes' }] },
      { id: 11, roles: [{ name: 'admin' }], modules: [] },
    ]);
    const action = await run('list_invoice_approvers', {});
    expect(action.result).toEqual({
      total: 2,
      approvers: [
        { approverId: 9, name: 'Grace', email: 'g@x' },
        { approverId: 11, name: 'Ivy', email: 'i@x' },
      ],
    });
  });

  it('submit_invoice_for_approval and delete_invoice relay the page\'s own refusals', async () => {
    lib.submitInvoiceForApproval.mockResolvedValue({ error: 'You cannot approve your own invoice — pick another approver' });
    expect(errorOf(await run('submit_invoice_for_approval', { invoiceId: 40, approverId: 7 }))).toContain('pick another approver');
    lib.deleteInvoice.mockResolvedValue({ error: 'Only draft invoices can be deleted. Void sent invoices instead.' });
    expect(errorOf(await run('delete_invoice', { invoiceId: 40 }))).toContain('Only draft invoices can be deleted');
    expect(lib.recordAuditEvent).not.toHaveBeenCalled();
  });
});

// --- Quotes --------------------------------------------------------------------------

describe('quotes', () => {
  it('update_quote refuses an empty items list and deletes nothing', async () => {
    const action = await run('update_quote', { quoteId: 12, items: [] });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('items cannot be empty: a quote needs at least one line');
    expect(lib.updateDraftQuote).not.toHaveBeenCalled();
  });

  it('update_quote refuses a line the page would refuse, instead of dropping or defaulting it', async () => {
    const line = { description: 'Transfer', quantity: 1, unitPrice: 100 };
    expect(errorOf(await run('update_quote', { quoteId: 12, items: [line, { quantity: 1, unitPrice: 5 }] }))).toContain('items[2].description is required');
    expect(errorOf(await run('update_quote', { quoteId: 12, items: [{ description: 'Transfer', unitPrice: 5 }] }))).toContain('items[1].quantity is required');
    expect(errorOf(await run('update_quote', { quoteId: 12, items: [{ ...line, unitPrice: '$1,200' }] }))).toContain('items[1].unitPrice must be a number');
    expect(errorOf(await run('update_quote', { quoteId: 12, items: [{ ...line, quantity: 0 }] }))).toContain('Line 1: quantity: Quantity must be greater than zero');
    expect(errorOf(await run('update_quote', { quoteId: 12, items: [{ ...line, description: '  ' }] }))).toContain('Line 1: description: Item description is required');
    expect(lib.updateDraftQuote).not.toHaveBeenCalled();
  });

  it('add_quote_line keeps the existing lines, with their discounts, days and product links', async () => {
    const added = { ...escort, id: 303, description: 'Fuel surcharge', quantity: 1, unitPrice: 60, total: 60 };
    lib.updateDraftQuote.mockResolvedValue(quote({ items: [transfer, escort, added], total: 1359.2 }));
    const action = await run('add_quote_line', { quoteId: 12, description: 'Fuel surcharge', quantity: 1, unitPrice: 60 });
    expect(action.ok).toBe(true);
    expect(lib.updateDraftQuote.mock.calls[0][0]).toEqual({
      id: 12,
      userId: 7,
      isAdmin: false,
      input: {
        items: [
          { description: 'Airport transfer', quantity: 2, days: 3, unitPrice: 150, taxable: true, discountType: 'percentage', discountValue: 10, productId: 44 },
          { description: 'Close protection officer', quantity: 1, days: 1, unitPrice: 400, taxable: false, discountType: 'none', discountValue: 0, productId: null },
          { description: 'Fuel surcharge', quantity: 1, unitPrice: 60 },
        ],
      },
    });
    expect(action.result).toMatchObject({ reference: 'QT-2026-0012', added: { lineId: 303, position: 3 }, total: { from: 1289.6, to: 1359.2 } });
    expect(action.summary).toContain('Added "Fuel surcharge" to quote QT-2026-0012');
    expect(action.href).toBe('/modules/quotes/12/edit');
  });

  it('update_quote_line changes one line by position and leaves the rest as they were', async () => {
    lib.updateDraftQuote.mockResolvedValue(quote({ items: [{ ...transfer, quantity: 4, total: 1620 }, escort], total: 2229.2 }));
    const action = await run('update_quote_line', { quoteId: 12, position: 1, quantity: 4 });
    const sent = lib.updateDraftQuote.mock.calls[0][0].input.items;
    expect(sent[0]).toEqual({ description: 'Airport transfer', quantity: 4, days: 3, unitPrice: 150, taxable: true, discountType: 'percentage', discountValue: 10, productId: 44 });
    expect(sent[1]).toMatchObject({ description: 'Close protection officer', taxable: false });
    expect(action.result).toMatchObject({ changed: { quantity: { from: 2, to: 4 } } });

    lib.updateDraftQuote.mockClear();
    expect(errorOf(await run('update_quote_line', { quoteId: 12, lineId: 301, quantity: 2 }))).toContain('Nothing to change');
    expect(errorOf(await run('update_quote_line', { quoteId: 12, lineId: 999, quantity: 5 }))).toContain('Line 999 is not on QT-2026-0012');
    expect(errorOf(await run('update_quote_line', { quoteId: 12, position: 3, quantity: 5 }))).toContain('there is no line 3');
    expect(lib.updateDraftQuote).not.toHaveBeenCalled();
  });

  it('remove_quote_line takes one line off, and refuses to remove the last', async () => {
    lib.updateDraftQuote.mockResolvedValue(quote({ items: [escort], total: 400 }));
    const action = await run('remove_quote_line', { quoteId: 12, lineId: 301 });
    expect(lib.updateDraftQuote.mock.calls[0][0].input.items).toEqual([
      { description: 'Close protection officer', quantity: 1, days: 1, unitPrice: 400, taxable: false, discountType: 'none', discountValue: 0, productId: null },
    ]);
    expect(action.result).toMatchObject({ removed: { lineId: 301, description: 'Airport transfer' } });

    lib.updateDraftQuote.mockClear();
    lib.getQuoteForUser.mockResolvedValue(quote({ items: [escort] }));
    expect(errorOf(await run('remove_quote_line', { quoteId: 12, position: 1 }))).toContain('is the only line on QT-2026-0012');
    expect(lib.updateDraftQuote).not.toHaveBeenCalled();
  });

  it('a quote can be created with an approver and submitted', async () => {
    const created = quote({ approver: { id: 9, name: 'Grace', email: 'g@x' } });
    lib.createQuote.mockResolvedValue(created);
    const action = await run('create_quote', {
      customerId: 3,
      subject: 'Nairobi arrival',
      approverId: 9,
      issueDate: '2026-11-24',
      items: [{ description: 'Airport transfer', quantity: 2, days: 3, unitPrice: 150, productId: 44 }],
    });
    expect(action.ok).toBe(true);
    expect(lib.createQuote.mock.calls[0][0]).toMatchObject({
      customerId: 3,
      approverId: 9,
      // The builder's starting point: the default company, the company's currency and tax rate, 30 days to expiry.
      brandProfileId: 2,
      currency: 'KES',
      taxRate: 0.16,
      issueDate: '2026-11-24',
      expiryDate: '2026-12-24',
      items: [{ description: 'Airport transfer', quantity: 2, days: 3, unitPrice: 150, productId: 44 }],
      createdById: 7,
    });
    expect(action.result).toMatchObject({ reference: 'QT-2026-0012', approver: 'Grace' });

    lib.submitQuote.mockResolvedValue({ ...created, status: 'Submitted' });
    const submitted = await run('submit_quote', { quoteId: 12 });
    expect(submitted.result).toMatchObject({ status: 'Submitted', approver: 'Grace' });
    expect(audited()).toEqual(['quote.created', 'quote.submitted']);
    expect(tool('list_quote_approvers').requiredModule).toEqual(API_ACCESS.quoteBranding);
  });

  it('update_quote can set the approver, and submit_quote says how when there is none', async () => {
    lib.updateDraftQuote.mockResolvedValue(quote({ approver: { id: 9, name: 'Grace', email: 'g@x' } }));
    const action = await run('update_quote', { quoteId: 12, approverId: 9 });
    expect(lib.updateDraftQuote.mock.calls[0][0].input).toEqual({ approverId: 9 });
    expect(action.result).toMatchObject({ changed: { approver: { from: null, to: 'Grace' } } });

    lib.submitQuote.mockResolvedValue({ error: 'Assign an approver before submitting' });
    expect(errorOf(await run('submit_quote', { quoteId: 12 }))).toContain('Set one with update_quote (approverId from list_quote_approvers)');
  });

  it('create_quote checks the client and the approver before saving, and the dates against each other', async () => {
    const base = { customerId: 3, subject: 'X', items: [{ description: 'Transfer', quantity: 1, unitPrice: 100 }] };
    expect(errorOf(await run('create_quote', { ...base, approverId: 7 }))).toContain('You cannot assign yourself as the approver');
    expect(errorOf(await run('create_quote', { ...base, approverId: 55 }))).toContain('User 55 is not available as an approver');
    expect(errorOf(await run('create_quote', { ...base, issueDate: '2026-11-24', expiryDate: '2026-11-01' }))).toContain(
      'expiryDate (2026-11-01) is before issueDate (2026-11-24)',
    );
    lib.getProductById.mockResolvedValue(null);
    expect(errorOf(await run('create_quote', { ...base, items: [{ ...base.items[0], productId: 77 }] }))).toContain('Product 77 is not in the catalogue');
    lib.getCustomerById.mockResolvedValue(null);
    expect(errorOf(await run('create_quote', base))).toContain('Client 3 was not found');
    expect(lib.createQuote).not.toHaveBeenCalled();
  });

  it('update_quote changes the issue date, and only sends what was given', async () => {
    lib.updateDraftQuote.mockResolvedValue(quote({ issueDate: '2026-11-22T00:00:00.000Z' }));
    const action = await run('update_quote', { quoteId: 12, issueDate: '2026-11-22' });
    // Not currency "USD" or discountType "none", which the page's update schema would add back.
    expect(lib.updateDraftQuote.mock.calls[0][0].input).toEqual({ issueDate: '2026-11-22' });
    expect(action.result).toMatchObject({ changed: { issueDate: { from: '2026-11-20', to: '2026-11-22' } } });
    expect(audited()).toEqual(['quote.updated']);
  });

  it('send_quote mirrors the page: approved only, email first, then Sent', async () => {
    const send = tool('send_quote');
    expect(send.destructive).toBe(true);
    expect(send.confirmLabel!({ quoteId: 12, reference: 'QT-2026-0012' })).toBe('Email quote QT-2026-0012 to the client and mark it Sent');

    expect(errorOf(await run('send_quote', { quoteId: 12 }))).toContain('QT-2026-0012 is Draft. Only an approved quote can be sent');
    lib.getQuoteForUser.mockResolvedValue(quote({ status: 'Approved', createdBy: { id: 8, name: 'Brian', email: 'b@x' } }));
    expect(errorOf(await run('send_quote', { quoteId: 12 }))).toContain('Only the creator can dispatch this quote');
    lib.getQuoteForUser.mockResolvedValue(quote({ status: 'Approved' }));
    lib.isEmailConfigured.mockReturnValue(false);
    expect(errorOf(await run('send_quote', { quoteId: 12 }))).toContain('Email is not set up yet');
    lib.isEmailConfigured.mockReturnValue(true);
    lib.getQuoteForUser.mockResolvedValue(quote({ status: 'Approved', customer: { id: 3, name: 'Bridge Corp', company: null, email: null } }));
    expect(errorOf(await run('send_quote', { quoteId: 12 }))).toContain('Bridge Corp has no email address on file');
    expect(lib.emailQuoteToCustomer).not.toHaveBeenCalled();
    expect(lib.markQuoteSent).not.toHaveBeenCalled();

    lib.getQuoteForUser.mockResolvedValue(quote({ status: 'Approved' }));
    const order: string[] = [];
    lib.emailQuoteToCustomer.mockImplementation(async () => {
      order.push('email');
      return { to: 'ops@bridge.example' };
    });
    lib.markQuoteSent.mockImplementation(async () => {
      order.push('mark');
      return quote({ status: 'Sent' });
    });
    const action = await run('send_quote', { quoteId: 12 });
    expect(order).toEqual(['email', 'mark']);
    expect(action.summary).toBe('Emailed quote QT-2026-0012 to ops@bridge.example and marked it Sent');
    expect(audited()).toEqual(['quote.sent']);
  });

  it('decide_quote says approve or decline and names the quote', async () => {
    const decide = tool('decide_quote');
    expect(decide.destructive).toBe(true);
    expect(decide.confirmLabel!({ quoteId: 12, decision: 'approved', reference: 'QT-2026-0012' })).toBe('Approve quote QT-2026-0012');
    expect(decide.confirmLabel!({ quoteId: 12, decision: 'declined', reference: 'QT-2026-0012' })).toBe('Decline quote QT-2026-0012');
    lib.decideQuote.mockResolvedValue(quote({ status: 'Approved' }));
    const action = await run('decide_quote', { quoteId: 12, decision: 'approved' });
    expect(lib.decideQuote).toHaveBeenCalledWith({ id: 12, userId: 7, isAdmin: false, decision: 'approved', note: null });
    expect(action.summary).toBe('Approved quote QT-2026-0012');
    expect(audited()).toEqual(['quote.approved']);
  });

  it('list_quotes passes search and filters through and reports total and more; get_quote returns the lines', async () => {
    lib.listQuotesForUser.mockResolvedValue([
      quote(),
      quote({ id: 13, reference: 'QT-2026-0013', subject: 'Kampala', status: 'Submitted', approver: { id: 7, name: 'Amina', email: 'a@x' } }),
      ...Array.from({ length: 30 }, (_, i) => quote({ id: 100 + i, reference: `QT-2025-${i}`, status: 'Sent' })),
    ]);
    expect(lib.listQuotesForUser).not.toHaveBeenCalled();
    const all = await run('list_quotes', {});
    expect(lib.listQuotesForUser).toHaveBeenCalledWith({ userId: 7, isAdmin: false });
    expect(all.result).toMatchObject({ total: 32, page: 1, more: true });
    expect((await run('list_quotes', { q: 'kampala' })).result).toMatchObject({
      total: 1,
      more: false,
      quotes: [{ id: 13, reference: 'QT-2026-0013', status: 'Submitted', issueDate: '2026-11-20', expiryDate: '2026-12-20', currency: 'USD', approver: 'Amina' }],
    });
    expect((await run('list_quotes', { status: 'Draft' })).result).toMatchObject({ total: 1 });
    expect((await run('list_quotes', { awaitingMyApproval: true })).result).toMatchObject({ total: 1, quotes: [{ id: 13 }] });
    expect(errorOf(await run('list_quotes', { status: 'draft' }))).toContain('status must be one of');

    const opened = await run('get_quote', { quoteId: 12 });
    expect(opened.result).toMatchObject({
      reference: 'QT-2026-0012',
      discount: '50 off',
      lines: [
        { lineId: 301, position: 1, description: 'Airport transfer', quantity: 2, days: 3, unitPrice: 150, discount: '10%', total: 810, productId: 44 },
        { lineId: 302, position: 2, taxable: false },
      ],
    });
  });
});

// --- Clients -------------------------------------------------------------------------

describe('clients', () => {
  it('delete_customer is admin-only and its label names what goes with it', async () => {
    const remove = tool('delete_customer');
    expect(remove.requiredRole).toBe('admin');
    expect(remove.destructive).toBe(true);
    const label = remove.confirmLabel!({ customerId: 3, name: 'Bridge Corp' });
    expect(label).toContain('Delete client Bridge Corp for good');
    expect(label).toContain('every deal and CRM activity');
    expect(label).toContain('contacts and travellers are kept but no longer linked');

    const refused = await run('delete_customer', { customerId: 3 });
    expect(errorOf(refused)).toContain('Only an administrator can delete a client');
    expect(lib.deleteCustomer).not.toHaveBeenCalled();
  });

  it('delete_customer gives the true reason when the client has quotes, invoices or trips', async () => {
    const admin = context({ isAdmin: true });
    lib.customerFindUnique.mockResolvedValue({
      name: 'Bridge Corp',
      _count: { quotes: 3, invoices: 1, trips: 0, deals: 2, crmActivities: 5, contacts: 1, travelers: 4 },
    });
    const blocked = await run('delete_customer', { customerId: 3 }, admin);
    expect(errorOf(blocked)).toContain('Bridge Corp cannot be deleted: it has 3 quotes, 1 invoice');
    expect(lib.deleteCustomer).not.toHaveBeenCalled();

    lib.customerFindUnique.mockResolvedValue({
      name: 'Bridge Corp',
      _count: { quotes: 0, invoices: 0, trips: 0, deals: 2, crmActivities: 5, contacts: 1, travelers: 4 },
    });
    expect(errorOf(await run('delete_customer', { customerId: 3, name: 'Zed Ltd' }, admin))).toContain('Client 3 is "Bridge Corp", not "Zed Ltd"');
    expect(lib.deleteCustomer).not.toHaveBeenCalled();

    lib.deleteCustomer.mockResolvedValue(true);
    const action = await run('delete_customer', { customerId: 3, name: 'Bridge Corp' }, admin);
    expect(action.result).toMatchObject({ deleted: true, deletedWithIt: { deals: 2, activities: 5 }, unlinked: { contacts: 1, travellers: 4 } });
    expect(action.summary).toBe('Deleted client Bridge Corp, with 2 deals and 5 CRM activities');
  });

  it('update_customer with a blank name is refused, and a blank email does not wipe the address', async () => {
    for (const args of [{ name: '' }, { name: '   ' }, { email: '' }, { phone: ' ' }]) {
      const action = await run('update_customer', { customerId: 3, ...args });
      expect(action.ok).toBe(false);
      expect(errorOf(action)).toMatch(/(name|email|phone) cannot be blank|is required/);
    }
    expect(errorOf(await run('update_customer', { customerId: 3, email: 'not-an-email' }))).toContain('Enter a valid email address');
    expect(errorOf(await run('update_customer', { customerId: 3 }))).toContain('Say what to change');
    expect(lib.updateCrmCustomer).not.toHaveBeenCalled();
  });

  it('update_customer saves through the CRM, with its gate, and reports what changed', async () => {
    expect(tool('update_customer').requiredModule).toEqual(API_ACCESS.crm);
    lib.updateCrmCustomer.mockResolvedValue(client({ email: 'new@bridge.example', billingAddress: 'PO Box 1', phone: null }));
    const action = await run('update_customer', { customerId: 3, email: 'New@Bridge.Example', billingAddress: 'PO Box 1', phone: null });
    expect(lib.updateCrmCustomer).toHaveBeenCalledWith(3, { email: 'new@bridge.example', billingAddress: 'PO Box 1', phone: null }, 7);
    expect(action.result).toMatchObject({
      changed: {
        email: { from: 'ops@bridge.example', to: 'new@bridge.example' },
        billingAddress: { from: null, to: 'PO Box 1' },
        phone: { from: '+254 700 000001', to: null },
      },
    });
    expect(action.summary).toBe('Updated client Bridge Corp: email, phone, billingAddress');
    expect(action.href).toBe('/modules/customers?open=3');
  });

  it('a no-op update is refused, not reported as done', async () => {
    lib.updateCrmCustomer.mockResolvedValue(client());
    const action = await run('update_customer', { customerId: 3, phone: '+254 700 000001' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('Nothing to change: client Bridge Corp already has those values');
    expect(lib.recordAuditEvent).not.toHaveBeenCalled();

    lib.updateDeal.mockResolvedValue(deal());
    expect(errorOf(await run('update_deal', { dealId: 90, value: 5000 }))).toContain('Nothing to change');
    lib.updateProduct.mockResolvedValue(product());
    expect(errorOf(await run('update_product', { productId: 44, name: 'Airport transfer' }))).toContain('Nothing to change');
    lib.updateDraftQuote.mockResolvedValue(quote());
    expect(errorOf(await run('update_quote', { quoteId: 12, subject: 'Nairobi arrival' }))).toContain('Nothing to change');
    lib.updateInvoice.mockResolvedValue(invoice());
    expect(errorOf(await run('update_invoice', { invoiceId: 40, currency: 'USD' }))).toContain('Nothing to change');
    expect(lib.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('create_customer validates and lower-cases the email, and takes a billing address and an entity', async () => {
    expect(tool('create_customer').requiredModule).toEqual(API_ACCESS.quoteCustomers);
    expect(errorOf(await run('create_customer', { name: 'Acme', email: 'nope' }))).toContain('Enter a valid email address');
    expect(errorOf(await run('create_customer', { name: 'A'.repeat(121) }))).toContain('name');
    expect(errorOf(await run('create_customer', { name: 'Acme', entity: 'LIONESS' }))).toContain('needs access to Clients');
    expect(lib.createCustomer).not.toHaveBeenCalled();

    lib.createCustomer.mockResolvedValue({ id: 21, name: 'Acme', email: 'info@acme.example', phone: null, company: null, billingAddress: 'PO Box 9' });
    lib.updateCrmCustomer.mockResolvedValue(client({ id: 21, name: 'Acme', entity: 'LIONESS' }));
    const action = await run(
      'create_customer',
      { name: ' Acme ', email: 'Info@Acme.Example', billingAddress: 'PO Box 9', entity: 'LIONESS' },
      context({ modules: ['customers'] }),
    );
    expect(lib.createCustomer).toHaveBeenCalledWith({
      name: 'Acme',
      email: 'info@acme.example',
      phone: null,
      company: null,
      address: null,
      billingAddress: 'PO Box 9',
      createdById: 7,
    });
    expect(lib.updateCrmCustomer).toHaveBeenCalledWith(21, { entity: 'LIONESS' }, 7);
    expect(action.result).toMatchObject({ id: 21, entity: 'LIONESS' });
    expect(audited()).toEqual(['customer.created']);
  });

  it('list_customers searches and pages, with phone and entity; get_customer shows only the areas this user holds', async () => {
    expect(tool('list_customers').requiredModule).toEqual(API_ACCESS.quoteCustomers);
    const found = await run('list_customers', { q: '000001' });
    expect(found.result).toMatchObject({
      total: 1,
      more: false,
      customers: [{ id: 3, name: 'Bridge Corp', phone: '+254 700 000001', entity: 'LADYASKARI', href: '/modules/customers?open=3' }],
    });
    lib.listCrmCustomers.mockResolvedValue(Array.from({ length: 25 }, (_, i) => client({ id: i + 1, name: `Client ${i + 1}` })));
    expect((await run('list_customers', {})).result).toMatchObject({ total: 25, more: true });

    lib.listCrmCustomers.mockResolvedValue([client()]);
    const plain = (await run('get_customer', { customerId: 3 })).result as Record<string, unknown>;
    expect(plain).toMatchObject({ name: 'Bridge Corp', entity: 'LADYASKARI' });
    expect(plain).not.toHaveProperty('contacts');
    expect(plain).not.toHaveProperty('unpaidInvoices');
    const withCrm = (await run('get_customer', { customerId: 3 }, context({ modules: ['customers'] }))).result;
    expect(withCrm).toMatchObject({ contacts: [{ contactId: 60, email: 'j@bridge.example' }], deals: [{ dealId: 90, stage: 'proposal' }] });
  });
});

// --- CRM -----------------------------------------------------------------------------

describe('crm', () => {
  it('update_deal with value "5k" is refused', async () => {
    const action = await run('update_deal', { dealId: 90, value: '5k' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('value must be a number');
    expect(lib.updateDeal).not.toHaveBeenCalled();
  });

  it.each([
    [{ title: '' }, 'title'],
    [{ expectedCloseDate: '15 Dec 2026' }, 'expectedCloseDate must be a real date'],
    [{ expectedCloseDate: '2026-02-30' }, 'expectedCloseDate must be a real date'],
    [{ currency: 'Kenyan shillings' }, 'three-letter currency code'],
    [{ value: -1 }, 'value cannot be less than 0'],
    [{ signatureStatus: 'pending' }, 'signatureStatus must be one of'],
    [{}, 'Say what to change on the deal'],
  ])('update_deal refuses %j and changes nothing', async (extra, message) => {
    const action = await run('update_deal', { dealId: 90, ...extra });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    expect(lib.updateDeal).not.toHaveBeenCalled();
  });

  it('update_deal takes currency, a quote of the same client, and null to clear', async () => {
    lib.listQuoteOptions.mockResolvedValue([
      { id: 12, reference: 'QT-2026-0012', subject: 'x', status: 'Approved', total: 1, customerId: 3 },
      { id: 13, reference: 'QT-2026-0013', subject: 'y', status: 'Approved', total: 1, customerId: 4 },
    ]);
    expect(errorOf(await run('update_deal', { dealId: 90, quoteId: 13 }))).toContain('QT-2026-0013 belongs to another client');
    expect(errorOf(await run('update_deal', { dealId: 90, contractId: 5 }))).toContain('Contract 5 was not found');
    expect(lib.updateDeal).not.toHaveBeenCalled();

    lib.updateDeal.mockResolvedValue(
      deal({ currency: 'KES', expectedCloseDate: null, quote: { id: 12, reference: 'QT-2026-0012', status: 'Approved', total: 1 } }),
    );
    const action = await run('update_deal', { dealId: 90, currency: 'kes', quoteId: 12, expectedCloseDate: null });
    expect(lib.updateDeal).toHaveBeenCalledWith(90, { currency: 'KES', quoteId: 12, expectedCloseDate: null });
    expect(action.result).toMatchObject({
      changed: {
        currency: { from: 'USD', to: 'KES' },
        quote: { from: null, to: 'QT-2026-0012' },
        expectedCloseDate: { from: '2026-12-15', to: null },
      },
    });
  });

  it('create_deal refuses a value or date it cannot read, and passes a linked quote and contract', async () => {
    const base = { title: 'Retainer', customerId: 3 };
    expect(errorOf(await run('create_deal', { ...base, value: '5k' }))).toContain('value must be a number');
    expect(errorOf(await run('create_deal', { ...base, expectedCloseDate: 'next month' }))).toContain('expectedCloseDate must be a real date');
    expect(errorOf(await run('create_deal', { ...base, currency: 'Kenyan shillings' }))).toContain('three-letter currency code');
    expect(lib.createDeal).not.toHaveBeenCalled();

    lib.listQuoteOptions.mockResolvedValue([{ id: 12, reference: 'QT-2026-0012', subject: 'x', status: 'Approved', total: 1, customerId: 3 }]);
    lib.listContractOptions.mockResolvedValue([{ id: 5, reference: 'CT-5', counterpartyName: 'Bridge', status: 'Active' }]);
    lib.createDeal.mockResolvedValue(deal());
    await run('create_deal', { ...base, value: 5000, quoteId: 12, contractId: 5, expectedCloseDate: '2026-12-15' });
    expect(lib.createDeal).toHaveBeenCalledWith(7, expect.objectContaining({ value: 5000, quoteId: 12, contractId: 5, expectedCloseDate: '2026-12-15' }));
  });

  it('log_crm_activity refuses a deal of another client', async () => {
    lib.listDeals.mockResolvedValue([deal({ id: 91, title: 'Zed pilot', customer: { id: 4, name: 'Zed Ltd', entity: 'LIONESS' } })]);
    const action = await run('log_crm_activity', { customerId: 3, type: 'call', summary: 'Rang the travel desk', dealId: 91 });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('Deal "Zed pilot" belongs to Zed Ltd, not Bridge Corp');
    expect(errorOf(await run('log_crm_activity', { customerId: 3, type: 'call', summary: 'x', dealId: 404 }))).toContain('Deal 404 was not found');
    expect(errorOf(await run('log_crm_activity', { customerId: 3, type: 'call', summary: 'x', contactId: 999 }))).toContain(
      "Contact 999 is not one of Bridge Corp's contacts",
    );
    expect(lib.createActivity).not.toHaveBeenCalled();
  });

  it("log_crm_activity takes a date and time in the user's zone and a contact, and is audited", async () => {
    lib.createActivity.mockResolvedValue({
      id: 700,
      customerId: 3,
      dealId: 90,
      contactId: 60,
      contactName: 'J. Doe',
      type: 'meeting',
      summary: 'Kick-off',
      occurredAt: '2026-11-20T11:30:00.000Z',
      createdBy: 'Amina',
    });
    const action = await run('log_crm_activity', {
      customerId: 3,
      type: 'meeting',
      summary: 'Kick-off',
      dealId: 90,
      contactId: 60,
      date: '2026-11-20',
      time: '14:30',
    });
    expect(lib.createActivity).toHaveBeenCalledWith(7, {
      customerId: 3,
      dealId: 90,
      contactId: 60,
      type: 'meeting',
      summary: 'Kick-off',
      // 14:30 in Nairobi.
      occurredAt: '2026-11-20T11:30:00.000Z',
    });
    expect(action.result).toMatchObject({ when: '2026-11-20 14:30', contact: 'J. Doe', deal: 'Annual retainer' });
    expect(audited()).toEqual(['ai.activity.create']);

    lib.createActivity.mockClear();
    await run('log_crm_activity', { customerId: 3, type: 'note', summary: 'Now' });
    expect(lib.createActivity.mock.calls[0][1]).toMatchObject({ occurredAt: null, dealId: null, contactId: null });
    expect(errorOf(await run('log_crm_activity', { customerId: 3, type: 'note', summary: 'x', time: '2pm' }))).toContain('time must be a 24-hour time');
  });

  it('list_deals filters by client, stage and search, and its rows carry what the pipeline shows', async () => {
    lib.listDeals.mockResolvedValue([
      deal({ quote: { id: 12, reference: 'QT-2026-0012', status: 'Approved', total: 1 }, signatureStatus: 'sent', lostReason: 'Budget' }),
      deal({ id: 91, title: 'Zed pilot', stage: 'lead', value: 100, customer: { id: 4, name: 'Zed Ltd', entity: 'LIONESS' } }),
    ]);
    const mine = await run('list_deals', { customerId: 3 });
    expect(mine.result).toMatchObject({
      total: 1,
      more: false,
      value: { USD: 5000 },
      deals: [{ id: 90, expectedClose: '2026-12-15', signature: 'sent', quote: 'QT-2026-0012', lostReason: 'Budget', daysInStage: 23 }],
    });
    expect((await run('list_deals', { stage: 'lead' })).result).toMatchObject({ total: 1, deals: [{ id: 91 }] });
    expect((await run('list_deals', { q: 'zed' })).result).toMatchObject({ total: 1 });
    expect((await run('list_deals', { entity: 'LIONESS' })).result).toMatchObject({ total: 1 });
  });

  it('list_crm_customers returns contacts with email and phone; list_crm_activities filters the log', async () => {
    const clients = await run('list_crm_customers', { q: 'j. doe' });
    expect(clients.result).toMatchObject({
      total: 1,
      customers: [{ id: 3, deals: 1, contacts: [{ contactId: 60, name: 'J. Doe', email: 'j@bridge.example', phone: '+254 700 000002' }] }],
    });

    lib.listCrmActivities.mockResolvedValue([
      { id: 1, customerId: 3, dealId: 90, contactId: null, contactName: null, type: 'call', summary: 'Rate discussed', occurredAt: '2026-11-20T11:30:00.000Z', createdBy: 'Amina' },
      { id: 2, customerId: 4, dealId: null, contactId: null, contactName: null, type: 'note', summary: 'Intro', occurredAt: '2026-11-19T08:00:00.000Z', createdBy: 'Brian' },
    ]);
    const log = await run('list_crm_activities', { customerId: 3 });
    expect(lib.listCrmActivities).toHaveBeenCalledWith(7);
    expect(log.result).toMatchObject({
      total: 1,
      more: false,
      activities: [{ id: 1, type: 'call', text: 'Rate discussed', when: '2026-11-20 14:30', client: 'Bridge Corp', dealId: 90, by: 'Amina' }],
    });
    expect((await run('list_crm_activities', { type: 'note' })).result).toMatchObject({ total: 1, activities: [{ id: 2, client: 'Zed Ltd' }] });
  });

  it('move_deal_stage, set_customer_entity and delete_deal report what they did', async () => {
    expect(errorOf(await run('move_deal_stage', { dealId: 90, stage: 'proposal' }))).toContain('already in proposal');
    lib.updateDeal.mockResolvedValue(deal({ stage: 'won' }));
    const moved = await run('move_deal_stage', { dealId: 90, stage: 'won' });
    expect(lib.updateDeal).toHaveBeenCalledWith(90, { stage: 'won' });
    expect(moved.summary).toBe('Moved deal "Annual retainer" from proposal to won');

    lib.updateCrmCustomer.mockResolvedValue(client({ entity: 'LIONESS' }));
    const entity = await run('set_customer_entity', { customerId: 3, entity: 'LIONESS' });
    expect(entity.result).toMatchObject({ changed: { entity: { from: 'LADYASKARI', to: 'LIONESS' } } });

    const remove = tool('delete_deal');
    expect(remove.destructive).toBe(true);
    expect(remove.confirmLabel!({ dealId: 90, title: 'Annual retainer' })).toContain('Delete the deal "Annual retainer" for good');
    lib.deleteDeal.mockResolvedValue(true);
    expect((await run('delete_deal', { dealId: 90, title: 'Annual retainer' })).summary).toBe('Deleted deal "Annual retainer" (Bridge Corp)');
  });
});

// --- Products ------------------------------------------------------------------------

describe('products', () => {
  it('list_products can include archived ones, searches and pages', async () => {
    expect(tool('list_products').requiredModule).toEqual(API_ACCESS.quoteProducts);
    lib.listProducts.mockResolvedValue([product(), product({ id: 45, name: 'Old escort', sku: 'ESC-OLD', archived: true })]);
    const action = await run('list_products', { includeArchived: true, q: 'esc-old' });
    expect(lib.listProducts).toHaveBeenCalledWith({ includeArchived: true });
    expect(action.result).toMatchObject({ total: 1, more: false, products: [{ id: 45, sku: 'ESC-OLD', archived: true }] });
    await run('list_products', {});
    expect(lib.listProducts).toHaveBeenLastCalledWith({ includeArchived: false });
    lib.listProducts.mockResolvedValue(Array.from({ length: 300 }, (_, i) => product({ id: i + 1 })));
    expect((await run('list_products', { page: 2 })).result).toMatchObject({ total: 300, page: 2, more: true });
  });

  it('create_product refuses a service code that is already used, a bad currency and a negative price', async () => {
    lib.findProductWithSku.mockResolvedValue({ id: 44, name: 'Airport transfer' });
    const clash = await run('create_product', { name: 'Transfer 2', defaultUnitPrice: 10, sku: 'TRF-NBO' });
    expect(errorOf(clash)).toContain('Service code TRF-NBO is already used by "Airport transfer"');
    expect(errorOf(await run('create_product', { name: 'X', defaultUnitPrice: 10, currency: 'Kenyan shillings' }))).toContain('three-letter currency code');
    expect(errorOf(await run('create_product', { name: 'X', defaultUnitPrice: -5 }))).toContain('defaultUnitPrice cannot be less than 0');
    expect(lib.createProduct).not.toHaveBeenCalled();

    lib.findProductWithSku.mockResolvedValue(null);
    lib.createProduct.mockResolvedValue(product({ id: 46, name: 'Meet and greet', sku: null, defaultUnitPrice: 75 }));
    await run('create_product', { name: 'Meet and greet', defaultUnitPrice: 75 });
    expect(lib.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Meet and greet', defaultUnitPrice: 75, currency: 'USD', taxable: true, sku: null, createdById: 7 }),
    );
    expect(audited()).toEqual(['quote.product.created']);
  });

  it('update_product refuses what it cannot read instead of ignoring it', async () => {
    for (const [extra, message] of [
      [{ name: '' }, 'name'],
      [{ taxable: 'yes' }, 'taxable must be true or false'],
      [{ archived: 'no' }, 'archived must be true or false'],
      [{ defaultUnitPrice: 'one fifty' }, 'defaultUnitPrice must be a number'],
      [{ defaultUnitPrice: -1 }, 'defaultUnitPrice cannot be less than 0'],
      [{ currency: 'dollars' }, 'three-letter currency code'],
    ] as const) {
      const action = await run('update_product', { productId: 44, ...extra });
      expect(action.ok).toBe(false);
      expect(errorOf(action)).toContain(message);
    }
    expect(lib.updateProduct).not.toHaveBeenCalled();
  });

  it('update_product takes a price sent as numeric text, can unarchive, and survives a failed audit write', async () => {
    lib.getProductById.mockResolvedValue(product({ archived: true }));
    lib.updateProduct.mockResolvedValue(product({ archived: false, defaultUnitPrice: 175 }));
    lib.recordAuditEvent.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = await run('update_product', { productId: 44, defaultUnitPrice: '175', archived: false });
    quiet.mockRestore();
    expect(lib.updateProduct).toHaveBeenCalledWith(44, expect.objectContaining({ defaultUnitPrice: 175, archived: false }));
    expect(action.ok).toBe(true);
    expect(action.result).toMatchObject({ changed: { defaultUnitPrice: { from: 150, to: 175 }, archived: { from: true, to: false } } });
  });

  it('delete_product says what it is unlinked from; get_product opens one', async () => {
    const remove = tool('delete_product');
    expect(remove.destructive).toBe(true);
    const label = remove.confirmLabel!({ productId: 44, name: 'Airport transfer' });
    expect(label).toContain('Quote and invoice lines that use it keep their text and price but lose the link');
    expect(label).toContain("removed from every vendor's catalogue");
    expect((await run('get_product', { productId: 44 })).result).toMatchObject({ name: 'Airport transfer', price: 150, details: { country: 'Kenya' } });
    lib.getProductById.mockResolvedValue(null);
    expect(errorOf(await run('delete_product', { productId: 9 }))).toContain('Product 9 was not found');
    expect(lib.deleteProduct).not.toHaveBeenCalled();
  });
});

// --- Across all of them --------------------------------------------------------------

describe('across the sales tools', () => {
  const lines = [{ description: 'Transfer', quantity: 1, unitPrice: 100 }];
  const nothingSaved = () => {
    for (const fn of [lib.createQuote, lib.updateDraftQuote, lib.createInvoice, lib.updateInvoice]) expect(fn).not.toHaveBeenCalled();
  };

  it.each([
    ['create_quote', { customerId: 3, subject: 'X', items: lines, issueDate: '24 Nov 2026' }, 'issueDate must be a real date'],
    ['create_quote', { customerId: 3, subject: 'X', items: lines, expiryDate: '2026-02-30' }, 'expiryDate must be a real date'],
    ['create_quote', { customerId: 3, subject: 'X', items: lines, issueDate: '5' }, 'issueDate must be a real date'],
    ['update_quote', { quoteId: 12, expiryDate: 'tomorrow' }, 'expiryDate must be a real date'],
    ['create_invoice', { customerId: 3, items: lines, dueDate: '2026-13-01' }, 'dueDate must be a real date'],
    ['update_invoice', { invoiceId: 40, issueDate: '01/12/2026' }, 'issueDate must be a real date'],
  ])('%s refuses an invalid date %j', async (name, args, message) => {
    const action = await run(name, args);
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    nothingSaved();
  });

  it.each([
    ['create_quote', { customerId: 3, subject: 'X', items: lines, currency: 'Kenyan shillings' }],
    ['update_quote', { quoteId: 12, currency: '' }],
    ['create_invoice', { customerId: 3, items: lines, currency: 'US' }],
    ['update_invoice', { invoiceId: 40, currency: 'shillings' }],
  ])('%s refuses an invalid currency %j', async (name, args) => {
    const action = await run(name, args);
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('three-letter currency code');
    nothingSaved();
  });

  it.each([
    ['create_quote', { customerId: 3, subject: 'X', items: lines, taxRate: 16 }, 'taxRate cannot be more than 1'],
    ['create_quote', { customerId: 3, subject: 'X', items: lines, taxRate: 'sixteen percent' }, 'taxRate must be a number'],
    ['update_quote', { quoteId: 12, taxRate: 100 }, 'taxRate cannot be more than 1'],
    ['create_invoice', { customerId: 3, items: lines, taxRate: -0.1 }, 'taxRate cannot be less than 0'],
    ['update_invoice', { invoiceId: 40, taxRate: 16 }, 'taxRate cannot be more than 1'],
  ])('%s refuses an invalid taxRate %j', async (name, args, message) => {
    const action = await run(name, args);
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    nothingSaved();
  });

  it('takes "0.16" as text for a 16% tax rate, and says 0.16 for 16% in the description', async () => {
    lib.updateDraftQuote.mockResolvedValue(quote({ taxRate: 0.08 }));
    await run('update_quote', { quoteId: 12, taxRate: '0.08' });
    expect(lib.updateDraftQuote.mock.calls[0][0].input).toEqual({ taxRate: 0.08 });
    for (const name of ['create_quote', 'update_quote', 'create_invoice', 'update_invoice']) {
      expect(tool(name).functionDeclaration.parameters.properties!.taxRate.description).toContain('0.16 for 16%');
    }
  });

  it('gates each tool as its page does', () => {
    const gate = (name: string) => tool(name).requiredModule;
    for (const name of ['list_deals', 'get_deal', 'create_deal', 'update_deal', 'log_crm_activity', 'list_crm_activities', 'set_customer_entity']) {
      expect(gate(name)).toEqual(API_ACCESS.crm);
    }
    for (const name of ['list_quotes', 'get_quote', 'create_quote', 'update_quote', 'add_quote_line', 'send_quote', 'submit_quote']) {
      expect(gate(name)).toEqual(API_ACCESS.quotes);
    }
    for (const name of ['list_invoices', 'get_invoice', 'create_invoice', 'send_invoice', 'record_invoice_payment', 'list_invoiceable_quotes']) {
      expect(gate(name)).toBe('invoices-review');
    }
    for (const name of ['list_products', 'get_product', 'create_product', 'update_product', 'delete_product']) {
      expect(gate(name)).toEqual(API_ACCESS.quoteProducts);
    }
    expect(tools.filter((t) => !t.requiredModule && !t.requiredRole).map((t) => t.functionDeclaration.name)).toEqual([]);
  });

  it('has a detail tool for each record, and holds every delete, send, decision, void and payment for Confirm', () => {
    const names = tools.map((t) => t.functionDeclaration.name);
    expect(names).toEqual(
      expect.arrayContaining(['get_customer', 'get_deal', 'get_quote', 'get_invoice', 'get_product', 'list_crm_activities', 'list_quote_approvers', 'send_quote']),
    );
    expect(new Set(names).size).toBe(names.length);
    const held = tools.filter((t) => t.destructive).map((t) => t.functionDeclaration.name).sort();
    expect(held).toEqual(
      [
        'decide_invoice', 'decide_quote', 'delete_customer', 'delete_deal', 'delete_invoice', 'delete_product', 'delete_quote',
        'record_invoice_payment', 'send_invoice', 'send_quote', 'void_invoice',
      ].sort(),
    );
    for (const t of tools.filter((candidate) => candidate.destructive)) expect(t.confirmLabel, t.functionDeclaration.name).toBeTypeOf('function');
  });

  it('keeps each area\'s declarations small enough to send on every step', () => {
    const size = (set: typeof tools) => JSON.stringify(set.map((t) => t.functionDeclaration)).length;
    const sizes = { clients: size(customerTools), crm: size(crmTools), quotes: size(quoteTools), invoices: size(invoiceTools), products: size(productTools) };
    for (const chars of Object.values(sizes)) expect(chars).toBeLessThan(11_000);
  });
});
