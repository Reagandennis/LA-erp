import 'server-only';

import { prisma } from './prisma';

/**
 * Wave (waveapps.com) accounting integration.
 *
 * Auth: OAuth2 authorization-code flow. The client id/secret come from env; the
 * refresh token + Wave business id are obtained when an admin clicks "Connect
 * Wave" and stored in WaveConnection. Access tokens are refreshed lazily.
 *
 * API: Wave exposes a single GraphQL endpoint. We mirror a customer and an
 * invoice (or a quote → estimate) on demand. A sync failure never blocks the
 * local document — the error is stored on the row (`waveSyncError`) and
 * surfaced in the UI.
 *
 * Routing is per-brand: an invoice/quote is only pushed to Wave when its brand
 * profile's `accountingProvider` is 'wave' (see brandUsesWave). Other brands
 * keep using QuickBooks.
 *
 * Requirements: a paid Wave plan (free "Starter" accounts can't authorize
 * third-party API access) and an OAuth application registered at
 * developer.waveapps.com to obtain the client id/secret.
 *
 * Env:
 *   WAVE_CLIENT_ID, WAVE_CLIENT_SECRET   OAuth app credentials
 *   WAVE_REDIRECT_URI                    OAuth callback (defaults to localhost)
 *   WAVE_BUSINESS_ID                     optional: pin a specific business
 */

const OAUTH_AUTHORIZE_URL = 'https://api.waveapps.com/oauth2/authorize/';
const OAUTH_TOKEN_URL = 'https://api.waveapps.com/oauth2/token/';
const GRAPHQL_URL = 'https://gql.waveapps.com/graphql/public';
const OAUTH_SCOPE = [
  'account:read',
  'business:read',
  'customer:read',
  'customer:write',
  'invoice:read',
  'invoice:write',
  'estimate:read',
  'estimate:write',
  'product:read',
  'product:write',
  'sales_tax:read',
].join(' ');

function clientId() {
  return process.env.WAVE_CLIENT_ID?.trim() ?? '';
}
function clientSecret() {
  return process.env.WAVE_CLIENT_SECRET?.trim() ?? '';
}
function redirectUri() {
  return process.env.WAVE_REDIRECT_URI?.trim() || 'http://localhost:3000/api/wave/callback';
}

export function isWaveConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** Cookie carrying the OAuth CSRF state between /connect and /callback. */
export const WAVE_STATE_COOKIE = 'wave_oauth_state';

export interface WaveStatus {
  configured: boolean;
  connected: boolean;
  businessId: string | null;
}

export async function getWaveStatus(): Promise<WaveStatus> {
  const configured = isWaveConfigured();
  if (!configured) return { configured, connected: false, businessId: null };
  const connection = await getConnection();
  return { configured, connected: Boolean(connection), businessId: connection?.businessId ?? null };
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPE,
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function requestTokens(extra: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    ...extra,
  });
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = (await response.json().catch(() => null)) as TokenResponse | { error?: string } | null;
  if (!response.ok || !data || !('access_token' in data)) {
    const detail = data && 'error' in data ? data.error : `HTTP ${response.status}`;
    throw new Error(`Wave token request failed: ${detail}`);
  }
  return data;
}

export async function completeWaveConnection(params: { code: string; userId: number }): Promise<void> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: redirectUri(),
  });

  const businessId = await fetchBusinessId(tokens.access_token);

  // Single Wave business: replace any previous connection.
  await prisma.$transaction([
    prisma.waveConnection.deleteMany({}),
    prisma.waveConnection.create({
      data: {
        businessId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedById: params.userId,
      },
    }),
  ]);
}

export async function disconnectWave(): Promise<void> {
  await prisma.waveConnection.deleteMany({});
}

type Connection = {
  id: number;
  businessId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
};

async function getConnection(): Promise<Connection | null> {
  return prisma.waveConnection.findFirst({ orderBy: { id: 'desc' } });
}

async function getActiveConnection(): Promise<Connection | null> {
  const connection = await getConnection();
  if (!connection) return null;

  const expiresSoon = connection.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return connection;

  const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: connection.refreshToken });
  return prisma.waveConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
}

// ---------------------------------------------------------------------------
// GraphQL client
// ---------------------------------------------------------------------------

async function graphql<T>(accessToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; errors?: Array<{ message?: string }> }
    | null;
  if (!response.ok || !json || json.errors?.length) {
    const message = json?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new Error(`Wave API error: ${message}`);
  }
  return json.data as T;
}

/** The first business on the connected Wave account (or WAVE_BUSINESS_ID). */
async function fetchBusinessId(accessToken: string): Promise<string> {
  const pinned = process.env.WAVE_BUSINESS_ID?.trim();
  if (pinned) return pinned;
  type BusinessesResponse = { businesses?: { edges?: Array<{ node: { id: string } }> } };
  const data = await graphql<BusinessesResponse>(
    accessToken,
    `query { businesses(page: 1, pageSize: 1) { edges { node { id } } } }`,
    {},
  );
  const id = data.businesses?.edges?.[0]?.node?.id;
  if (!id) throw new Error('No Wave business found on this account');
  return id;
}

/** The account id of an income account, to attach a product to. */
async function fetchIncomeAccountId(connection: Connection): Promise<string> {
  type AccountsResponse = {
    business?: { accounts?: { edges?: Array<{ node: { id: string } }> } };
  };
  const data = await graphql<AccountsResponse>(
    connection.accessToken,
    `query ($businessId: ID!) {
      business(id: $businessId) {
        accounts(types: INCOME, page: 1, pageSize: 1) { edges { node { id } } }
      }
    }`,
    { businessId: connection.businessId },
  );
  const id = data.business?.accounts?.edges?.[0]?.node?.id;
  if (!id) throw new Error('No income account found in Wave to attach a product to');
  return id;
}

// ---------------------------------------------------------------------------
// Entity mirroring
// ---------------------------------------------------------------------------

async function ensureWaveCustomer(
  connection: Connection,
  customer: { id: number; name: string; email: string | null; waveCustomerId: string | null },
): Promise<string> {
  if (customer.waveCustomerId) return customer.waveCustomerId;

  type CustomerCreateResponse = {
    customerCreate: {
      didSucceed: boolean;
      customer: { id: string } | null;
      inputErrors: Array<{ message: string }> | null;
    };
  };
  const data = await graphql<CustomerCreateResponse>(
    connection.accessToken,
    `mutation ($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        didSucceed
        customer { id }
        inputErrors { message }
      }
    }`,
    {
      input: {
        businessId: connection.businessId,
        name: customer.name,
        ...(customer.email ? { email: customer.email } : {}),
      },
    },
  );
  if (!data.customerCreate.didSucceed || !data.customerCreate.customer) {
    throw new Error(data.customerCreate.inputErrors?.[0]?.message ?? 'Wave customerCreate failed');
  }
  const waveId = data.customerCreate.customer.id;
  await prisma.customer.update({ where: { id: customer.id }, data: { waveCustomerId: waveId } });
  return waveId;
}

/** Find (or create) a generic "Services" product to carry mirrored document lines. */
async function ensureWaveProduct(connection: Connection): Promise<string> {
  type ProductsResponse = {
    business?: { products?: { edges?: Array<{ node: { id: string } }> } };
  };
  const existing = await graphql<ProductsResponse>(
    connection.accessToken,
    `query ($businessId: ID!) {
      business(id: $businessId) { products(page: 1, pageSize: 1) { edges { node { id } } } }
    }`,
    { businessId: connection.businessId },
  );
  const found = existing.business?.products?.edges?.[0]?.node?.id;
  if (found) return found;

  const incomeAccountId = await fetchIncomeAccountId(connection);
  type ProductCreateResponse = {
    productCreate: {
      didSucceed: boolean;
      product: { id: string } | null;
      inputErrors: Array<{ message: string }> | null;
    };
  };
  const data = await graphql<ProductCreateResponse>(
    connection.accessToken,
    `mutation ($input: ProductCreateInput!) {
      productCreate(input: $input) {
        didSucceed
        product { id }
        inputErrors { message }
      }
    }`,
    { input: { businessId: connection.businessId, name: 'Services', unitPrice: 0, incomeAccountId } },
  );
  if (!data.productCreate.didSucceed || !data.productCreate.product) {
    throw new Error(data.productCreate.inputErrors?.[0]?.message ?? 'Wave productCreate failed');
  }
  return data.productCreate.product.id;
}

function toWaveDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type WaveSyncResult =
  | { status: 'synced'; waveId: string }
  | { status: 'skipped'; reason: 'not_configured' | 'not_connected' | 'not_wave_brand' }
  | { status: 'failed'; error: string };

/** True when a brand profile routes its accounting to Wave. */
export async function brandUsesWave(brandProfileId: number | null | undefined): Promise<boolean> {
  if (!brandProfileId) return false;
  const brand = await prisma.brandProfile.findUnique({
    where: { id: brandProfileId },
    select: { accountingProvider: true },
  });
  return brand?.accountingProvider === 'wave';
}

export async function syncInvoiceToWave(invoiceId: number): Promise<WaveSyncResult> {
  if (!isWaveConfigured()) return { status: 'skipped', reason: 'not_configured' };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, email: true, waveCustomerId: true } },
    },
  });
  if (!invoice) return { status: 'failed', error: 'Invoice not found' };
  if (!(await brandUsesWave(invoice.brandProfileId))) return { status: 'skipped', reason: 'not_wave_brand' };

  try {
    const connection = await getActiveConnection();
    if (!connection) return { status: 'skipped', reason: 'not_connected' };

    if (invoice.waveInvoiceId) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { waveSyncError: null } });
      return { status: 'synced', waveId: invoice.waveInvoiceId };
    }

    const waveCustomerId = await ensureWaveCustomer(connection, invoice.customer);
    const productId = await ensureWaveProduct(connection);

    type InvoiceCreateResponse = {
      invoiceCreate: {
        didSucceed: boolean;
        invoice: { id: string } | null;
        inputErrors: Array<{ message: string }> | null;
      };
    };
    const data = await graphql<InvoiceCreateResponse>(
      connection.accessToken,
      `mutation ($input: InvoiceCreateInput!) {
        invoiceCreate(input: $input) {
          didSucceed
          invoice { id }
          inputErrors { message }
        }
      }`,
      {
        input: {
          businessId: connection.businessId,
          customerId: waveCustomerId,
          currency: invoice.currency,
          invoiceDate: toWaveDate(invoice.issueDate),
          dueDate: toWaveDate(invoice.dueDate),
          invoiceNumber: invoice.number,
          items: [
            {
              productId,
              description: `LA-ERP invoice ${invoice.number}`,
              quantity: 1,
              unitPrice: Number(invoice.total),
            },
          ],
        },
      },
    );
    if (!data.invoiceCreate.didSucceed || !data.invoiceCreate.invoice) {
      throw new Error(data.invoiceCreate.inputErrors?.[0]?.message ?? 'Wave invoiceCreate failed');
    }
    const waveId = data.invoiceCreate.invoice.id;
    await prisma.invoice.update({ where: { id: invoiceId }, data: { waveInvoiceId: waveId, waveSyncError: null } });
    return { status: 'synced', waveId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wave sync failed';
    await prisma.invoice.update({ where: { id: invoiceId }, data: { waveSyncError: message } });
    return { status: 'failed', error: message };
  }
}

export async function syncQuoteToWave(quoteId: number): Promise<WaveSyncResult> {
  if (!isWaveConfigured()) return { status: 'skipped', reason: 'not_configured' };

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: { select: { id: true, name: true, email: true, waveCustomerId: true } },
    },
  });
  if (!quote) return { status: 'failed', error: 'Quote not found' };
  if (!(await brandUsesWave(quote.brandProfileId))) return { status: 'skipped', reason: 'not_wave_brand' };

  try {
    const connection = await getActiveConnection();
    if (!connection) return { status: 'skipped', reason: 'not_connected' };

    if (quote.waveEstimateId) {
      await prisma.quote.update({ where: { id: quoteId }, data: { waveSyncError: null } });
      return { status: 'synced', waveId: quote.waveEstimateId };
    }

    const waveCustomerId = await ensureWaveCustomer(connection, quote.customer);
    const productId = await ensureWaveProduct(connection);

    type EstimateCreateResponse = {
      estimateCreate: {
        didSucceed: boolean;
        estimate: { id: string } | null;
        inputErrors: Array<{ message: string }> | null;
      };
    };
    const data = await graphql<EstimateCreateResponse>(
      connection.accessToken,
      `mutation ($input: EstimateCreateInput!) {
        estimateCreate(input: $input) {
          didSucceed
          estimate { id }
          inputErrors { message }
        }
      }`,
      {
        input: {
          businessId: connection.businessId,
          customerId: waveCustomerId,
          currency: quote.currency,
          estimateDate: toWaveDate(quote.issueDate),
          expirationDate: toWaveDate(quote.expiryDate),
          estimateNumber: quote.reference,
          title: quote.subject,
          items: [
            {
              productId,
              description: `LA-ERP quote ${quote.reference}`,
              quantity: 1,
              unitPrice: Number(quote.total),
            },
          ],
        },
      },
    );
    if (!data.estimateCreate.didSucceed || !data.estimateCreate.estimate) {
      throw new Error(data.estimateCreate.inputErrors?.[0]?.message ?? 'Wave estimateCreate failed');
    }
    const waveId = data.estimateCreate.estimate.id;
    await prisma.quote.update({ where: { id: quoteId }, data: { waveEstimateId: waveId, waveSyncError: null } });
    return { status: 'synced', waveId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wave sync failed';
    await prisma.quote.update({ where: { id: quoteId }, data: { waveSyncError: message } });
    return { status: 'failed', error: message };
  }
}
