import 'server-only';

import { prisma } from './prisma';

/**
 * QuickBooks Online integration for the invoices module.
 *
 * Auth model: OAuth2 authorization-code flow. The client ID/secret come from
 * env; the refresh token + realm (company) id are obtained when an admin
 * clicks "Connect QuickBooks" and are stored in QuickBooksConnection. Access
 * tokens are refreshed lazily (Intuit rotates refresh tokens — always persist
 * the returned one).
 *
 * Sync model: when a payment is recorded locally we mirror, on demand, the
 * customer and invoice into QBO (matched by DisplayName / DocNumber, created
 * minimally if missing) and then record a Payment linked to that invoice.
 * A sync failure never blocks the local payment — it is stored on the
 * payment row (`quickbooksSyncError`) and reported to the UI.
 */

const OAUTH_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const OAUTH_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const OAUTH_SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';

function clientId() {
  return process.env.QUICKBOOKS_CLIENT_ID?.trim() ?? '';
}

function clientSecret() {
  return process.env.QUICKBOOKS_CLIENT_SECRET?.trim() ?? '';
}

function redirectUri() {
  return process.env.QUICKBOOKS_REDIRECT_URI?.trim() || 'http://localhost:3000/api/quickbooks/callback';
}

function apiBase() {
  return process.env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`;
}

export function isQuickBooksConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** Cookie carrying the OAuth CSRF state between /connect and /callback. */
export const QUICKBOOKS_STATE_COOKIE = 'qbo_oauth_state';

export interface QuickBooksStatus {
  configured: boolean;
  connected: boolean;
  realmId: string | null;
}

export async function getQuickBooksStatus(): Promise<QuickBooksStatus> {
  const configured = isQuickBooksConfigured();
  if (!configured) return { configured, connected: false, realmId: null };
  const connection = await getConnection();
  return { configured, connected: Boolean(connection), realmId: connection?.realmId ?? null };
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    scope: OAUTH_SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const data = (await response.json().catch(() => null)) as TokenResponse | { error?: string } | null;
  if (!response.ok || !data || !('access_token' in data)) {
    const detail = data && 'error' in data ? data.error : `HTTP ${response.status}`;
    throw new Error(`QuickBooks token request failed: ${detail}`);
  }
  return data;
}

export async function completeQuickBooksConnection(params: {
  code: string;
  realmId: string;
  userId: number;
}): Promise<void> {
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri(),
    }),
  );

  // Single-company integration: replace any previous connection.
  await prisma.$transaction([
    prisma.quickBooksConnection.deleteMany({}),
    prisma.quickBooksConnection.create({
      data: {
        realmId: params.realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedById: params.userId,
      },
    }),
  ]);
}

export async function disconnectQuickBooks(): Promise<void> {
  const connection = await getConnection();
  if (!connection) return;
  // Best-effort token revocation; the row is removed regardless.
  try {
    await fetch(OAUTH_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: connection.refreshToken }),
    });
  } catch {
    // ignore
  }
  await prisma.quickBooksConnection.deleteMany({});
}

type Connection = {
  id: number;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
};

async function getConnection(): Promise<Connection | null> {
  return prisma.quickBooksConnection.findFirst({ orderBy: { id: 'desc' } });
}

/** Returns a connection with a fresh access token, refreshing (and persisting) if needed. */
async function getActiveConnection(): Promise<Connection | null> {
  const connection = await getConnection();
  if (!connection) return null;

  const expiresSoon = connection.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return connection;

  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refreshToken }),
  );
  return prisma.quickBooksConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function qboRequest<T>(
  connection: Connection,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${apiBase()}/v3/company/${connection.realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=${MINOR_VERSION}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as T | { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } } | null;
  if (!response.ok) {
    const fault = data && typeof data === 'object' && 'Fault' in data ? data.Fault : undefined;
    const firstError = fault?.Error?.[0];
    const message = firstError ? `${firstError.Message ?? ''} ${firstError.Detail ?? ''}`.trim() : `HTTP ${response.status}`;
    throw new Error(`QuickBooks API error: ${message}`);
  }
  return data as T;
}

function qboQuery<T>(connection: Connection, query: string): Promise<T> {
  return qboRequest<T>(connection, 'GET', `/query?query=${encodeURIComponent(query)}`);
}

/** Escape a value for use inside a QBO SQL-ish query string literal. */
function escapeQbo(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toQboDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Entity mirroring
// ---------------------------------------------------------------------------

async function ensureQboCustomer(
  connection: Connection,
  customer: { id: number; name: string; email: string | null; phone: string | null; quickbooksCustomerId: string | null },
): Promise<string> {
  if (customer.quickbooksCustomerId) return customer.quickbooksCustomerId;

  type CustomerQueryResponse = { QueryResponse?: { Customer?: Array<{ Id: string }> } };
  const found = await qboQuery<CustomerQueryResponse>(
    connection,
    `select Id from Customer where DisplayName = '${escapeQbo(customer.name)}'`,
  );
  let qboId = found.QueryResponse?.Customer?.[0]?.Id ?? null;

  if (!qboId) {
    type CustomerCreateResponse = { Customer: { Id: string } };
    const created = await qboRequest<CustomerCreateResponse>(connection, 'POST', '/customer', {
      DisplayName: customer.name,
      ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
      ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
    });
    qboId = created.Customer.Id;
  }

  await prisma.customer.update({ where: { id: customer.id }, data: { quickbooksCustomerId: qboId } });
  return qboId;
}

/** Find (or create) a generic Service item to carry mirrored invoice lines. */
async function ensureQboServiceItem(connection: Connection): Promise<string> {
  type ItemQueryResponse = { QueryResponse?: { Item?: Array<{ Id: string }> } };
  const found = await qboQuery<ItemQueryResponse>(
    connection,
    "select Id from Item where Type = 'Service' maxresults 1",
  );
  const existing = found.QueryResponse?.Item?.[0]?.Id;
  if (existing) return existing;

  type AccountQueryResponse = { QueryResponse?: { Account?: Array<{ Id: string }> } };
  const income = await qboQuery<AccountQueryResponse>(
    connection,
    "select Id from Account where AccountType = 'Income' maxresults 1",
  );
  const incomeAccountId = income.QueryResponse?.Account?.[0]?.Id;
  if (!incomeAccountId) throw new Error('No income account found in QuickBooks to attach a service item to');

  type ItemCreateResponse = { Item: { Id: string } };
  const created = await qboRequest<ItemCreateResponse>(connection, 'POST', '/item', {
    Name: 'Services',
    Type: 'Service',
    IncomeAccountRef: { value: incomeAccountId },
  });
  return created.Item.Id;
}

async function ensureQboInvoice(
  connection: Connection,
  invoice: {
    id: number;
    number: string;
    issueDate: Date;
    dueDate: Date;
    total: number;
    quickbooksInvoiceId: string | null;
  },
  qboCustomerId: string,
): Promise<string> {
  if (invoice.quickbooksInvoiceId) return invoice.quickbooksInvoiceId;

  type InvoiceQueryResponse = { QueryResponse?: { Invoice?: Array<{ Id: string }> } };
  const found = await qboQuery<InvoiceQueryResponse>(
    connection,
    `select Id from Invoice where DocNumber = '${escapeQbo(invoice.number)}'`,
  );
  let qboId = found.QueryResponse?.Invoice?.[0]?.Id ?? null;

  if (!qboId) {
    const itemId = await ensureQboServiceItem(connection);
    type InvoiceCreateResponse = { Invoice: { Id: string } };
    const created = await qboRequest<InvoiceCreateResponse>(connection, 'POST', '/invoice', {
      CustomerRef: { value: qboCustomerId },
      DocNumber: invoice.number.slice(0, 21),
      TxnDate: toQboDate(invoice.issueDate),
      DueDate: toQboDate(invoice.dueDate),
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: invoice.total,
          Description: `LA-ERP invoice ${invoice.number}`,
          SalesItemLineDetail: { ItemRef: { value: itemId } },
        },
      ],
    });
    qboId = created.Invoice.Id;
  }

  await prisma.invoice.update({ where: { id: invoice.id }, data: { quickbooksInvoiceId: qboId } });
  return qboId;
}

// ---------------------------------------------------------------------------
// Payment sync
// ---------------------------------------------------------------------------

export type QuickBooksSyncResult =
  | { status: 'synced'; quickbooksPaymentId: string }
  | { status: 'skipped'; reason: 'not_configured' | 'not_connected' }
  | { status: 'failed'; error: string };

export async function syncInvoicePaymentToQuickBooks(paymentId: number): Promise<QuickBooksSyncResult> {
  if (!isQuickBooksConfigured()) return { status: 'skipped', reason: 'not_configured' };

  try {
    const connection = await getActiveConnection();
    if (!connection) return { status: 'skipped', reason: 'not_connected' };

    const payment = await prisma.invoicePayment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            customer: {
              select: { id: true, name: true, email: true, phone: true, quickbooksCustomerId: true },
            },
          },
        },
      },
    });
    if (!payment) return { status: 'failed', error: 'Payment not found' };
    if (payment.quickbooksPaymentId) {
      return { status: 'synced', quickbooksPaymentId: payment.quickbooksPaymentId };
    }

    const qboCustomerId = await ensureQboCustomer(connection, payment.invoice.customer);
    const qboInvoiceId = await ensureQboInvoice(
      connection,
      {
        id: payment.invoice.id,
        number: payment.invoice.number,
        issueDate: payment.invoice.issueDate,
        dueDate: payment.invoice.dueDate,
        total: Number(payment.invoice.total),
        quickbooksInvoiceId: payment.invoice.quickbooksInvoiceId,
      },
      qboCustomerId,
    );

    type PaymentCreateResponse = { Payment: { Id: string } };
    const created = await qboRequest<PaymentCreateResponse>(connection, 'POST', '/payment', {
      CustomerRef: { value: qboCustomerId },
      TotalAmt: Number(payment.amount),
      TxnDate: toQboDate(payment.paidAt),
      ...(payment.reference ? { PaymentRefNum: payment.reference.slice(0, 21) } : {}),
      Line: [
        {
          Amount: Number(payment.amount),
          LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }],
        },
      ],
    });

    await prisma.invoicePayment.update({
      where: { id: paymentId },
      data: { quickbooksPaymentId: created.Payment.Id, quickbooksSyncError: null },
    });
    return { status: 'synced', quickbooksPaymentId: created.Payment.Id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown QuickBooks sync error';
    console.error(`[quickbooks] payment ${paymentId} sync failed:`, message);
    await prisma.invoicePayment
      .update({ where: { id: paymentId }, data: { quickbooksSyncError: message.slice(0, 1000) } })
      .catch(() => null);
    return { status: 'failed', error: message };
  }
}
