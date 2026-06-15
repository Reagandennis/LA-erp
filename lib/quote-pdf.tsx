import 'server-only';

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import React from 'react';
import sharp from 'sharp';

import type { QuoteDetail } from './quotes';

export interface BrandPdfInfo {
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  primaryColor: string;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: '#111827', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { maxWidth: 240 },
  logo: { maxHeight: 60, maxWidth: 180, marginBottom: 6, objectFit: 'contain' },
  companyName: { fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 4 },
  companyMetaLine: { color: '#6B7280', fontSize: 9, marginTop: 1 },
  headerRight: { textAlign: 'right', minWidth: 200 },
  badge: { fontSize: 9, color: '#03458f', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  reference: { fontSize: 18, fontWeight: 700, color: '#111827' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 8 },
  metaCell: { textAlign: 'right' },
  metaLabel: { color: '#6B7280', textTransform: 'uppercase', fontSize: 8, letterSpacing: 1 },
  metaValue: { color: '#111827', fontWeight: 700, marginTop: 2 },
  blocksRow: { flexDirection: 'row', gap: 16, marginTop: 24 },
  block: { flex: 1, padding: 12, borderRadius: 6, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  blockTitle: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  blockLine: { color: '#1F2937', fontSize: 10, marginTop: 1 },
  subject: { marginTop: 24, fontSize: 14, fontWeight: 700, color: '#111827' },
  itemsTable: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  itemsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
  },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  colDescription: { flex: 4, paddingHorizontal: 6 },
  colQty: { flex: 1, paddingHorizontal: 6, textAlign: 'right' },
  colUnit: { flex: 1.4, paddingHorizontal: 6, textAlign: 'right' },
  colDiscount: { flex: 1.2, paddingHorizontal: 6, textAlign: 'right' },
  colTotal: { flex: 1.4, paddingHorizontal: 6, textAlign: 'right', fontWeight: 700 },
  headerText: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 },
  cellText: { color: '#111827' },
  totalsBox: {
    marginTop: 16,
    alignSelf: 'flex-end',
    width: 220,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { color: '#6B7280' },
  totalsValue: { color: '#111827', fontWeight: 700 },
  grandTotalLabel: { color: '#111827', fontWeight: 700, fontSize: 12 },
  grandTotalValue: { color: '#03458f', fontWeight: 700, fontSize: 14 },
  divider: { marginVertical: 6, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  notesBox: { marginTop: 24, padding: 12, backgroundColor: '#FFFBEB', borderRadius: 6 },
  termsBox: { marginTop: 12, padding: 12, backgroundColor: '#F9FAFB', borderRadius: 6 },
  notesTitle: { fontSize: 8, color: '#92400E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  termsTitle: { fontSize: 8, color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  notesBody: { color: '#78350F' },
  termsBody: { color: '#1F2937' },
  footer: { position: 'absolute', left: 40, right: 40, bottom: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 8 },
});

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = ', ') {
  return parts.filter((part) => part && part.trim().length > 0).join(separator);
}

/** Returns each non-empty address line as its own string */
function buildCompanyAddressLines(brand: BrandPdfInfo): string[] {
  const cityLine = joinNonEmpty([brand.city, brand.region, brand.postalCode], ' ');
  return [brand.addressLine1, brand.addressLine2, cityLine, brand.country].filter(
    (l): l is string => Boolean(l && l.trim()),
  );
}

interface QuotePdfProps {
  quote: QuoteDetail;
  brand: BrandPdfInfo;
  taxLabel: string;
  logoDataUri: string | null;
  customer: {
    name: string;
    company: string | null;
    email: string | null;
    address: string | null;
    billingAddress: string | null;
  };
}

function QuotePdfDocument({ quote, brand, taxLabel, logoDataUri, customer }: QuotePdfProps) {
  const currency = quote.currency;
  const addressLines = buildCompanyAddressLines(brand);

  const billToLines = [
    customer.company,
    customer.name,
    customer.email,
    customer.billingAddress,
  ].filter((l): l is string => Boolean(l));

  const shipToLines = [customer.address ?? customer.billingAddress].filter(
    (l): l is string => Boolean(l),
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoDataUri} style={styles.logo} />
            ) : null}
            {brand.companyName ? (
              <Text style={styles.companyName}>{brand.companyName}</Text>
            ) : null}
            {addressLines.map((line, i) => (
              <Text key={i} style={styles.companyMetaLine}>{line}</Text>
            ))}
            {brand.email ? (
              <Text style={styles.companyMetaLine}>{brand.email}</Text>
            ) : null}
            {brand.phone ? (
              <Text style={styles.companyMetaLine}>{brand.phone}</Text>
            ) : null}
            {brand.website ? (
              <Text style={styles.companyMetaLine}>{brand.website}</Text>
            ) : null}
          </View>

          <View style={styles.headerRight}>
            <Text style={[styles.badge, { color: brand.primaryColor }]}>Quotation</Text>
            <Text style={styles.reference}>{quote.reference}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Issue date</Text>
                <Text style={styles.metaValue}>{formatDate(quote.issueDate)}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Valid until</Text>
                <Text style={styles.metaValue}>{formatDate(quote.expiryDate)}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Status</Text>
                <Text style={styles.metaValue}>{quote.status}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Currency</Text>
                <Text style={styles.metaValue}>{currency}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Bill/Ship to ── */}
        <View style={styles.blocksRow}>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Bill to</Text>
            {billToLines.map((line, i) => (
              <Text key={i} style={styles.blockLine}>{line}</Text>
            ))}
            {billToLines.length === 0 ? <Text style={styles.blockLine}>—</Text> : null}
          </View>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Ship to</Text>
            {shipToLines.map((line, i) => (
              <Text key={i} style={styles.blockLine}>{line}</Text>
            ))}
            {shipToLines.length === 0 ? <Text style={styles.blockLine}>—</Text> : null}
          </View>
        </View>

        {/* ── Subject ── */}
        <Text style={styles.subject}>{quote.subject}</Text>

        {/* ── Items table ── */}
        <View style={styles.itemsTable}>
          <View style={styles.itemsHeader}>
            <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
            <Text style={[styles.colQty, styles.headerText]}>Days</Text>
            <Text style={[styles.colUnit, styles.headerText]}>Unit</Text>
            <Text style={[styles.colTotal, styles.headerText]}>Total</Text>
          </View>
          {quote.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.colDescription}>
                <Text style={styles.cellText}>{item.description}</Text>
                {!item.taxable ? (
                  <Text style={{ color: '#9CA3AF', fontSize: 8, marginTop: 2 }}>Not taxable</Text>
                ) : null}
              </View>
              <Text style={[styles.colQty, styles.cellText]}>{item.quantity}</Text>
              <Text style={[styles.colUnit, styles.cellText]}>{formatMoney(item.unitPrice, currency)}</Text>
              <Text style={styles.colTotal}>{formatMoney(item.total, currency)}</Text>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatMoney(quote.subtotal, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              {taxLabel} ({(quote.taxRate * 100).toFixed(2)}%)
            </Text>
            <Text style={styles.totalsValue}>{formatMoney(quote.tax, currency)}</Text>
          </View>
          {quote.discountType !== 'none' && quote.discountAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>
                Discount{quote.discountType === 'percentage' ? ` (${quote.discountValue}%)` : ''}
              </Text>
              <Text style={styles.totalsValue}>- {formatMoney(quote.discountAmount, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.totalsRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={[styles.grandTotalValue, { color: brand.primaryColor }]}>
              {formatMoney(quote.total, currency)}
            </Text>
          </View>
        </View>

        {/* ── Notes / Terms ── */}
        {quote.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesBody}>{quote.notes}</Text>
          </View>
        ) : null}
        {quote.terms ? (
          <View style={styles.termsBox}>
            <Text style={styles.termsTitle}>Terms & conditions</Text>
            <Text style={styles.termsBody}>{quote.terms}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {brand.companyName ?? ''}  •  {quote.reference}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(input: {
  quote: QuoteDetail;
  brand: BrandPdfInfo;
  taxLabel: string;
  logo: { buffer: Buffer; mimeType: string } | null;
  customer: QuotePdfProps['customer'];
}): Promise<Buffer> {
  let logoDataUri: string | null = null;

  if (input.logo) {
    try {
      // Convert any format (including SVG) to PNG for react-pdf compatibility
      const pngBuffer = await sharp(input.logo.buffer).png().toBuffer();
      logoDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch {
      // If conversion fails, skip the logo rather than crash the whole PDF
      logoDataUri = null;
    }
  }

  return renderToBuffer(
    <QuotePdfDocument
      quote={input.quote}
      brand={input.brand}
      taxLabel={input.taxLabel}
      logoDataUri={logoDataUri}
      customer={input.customer}
    />,
  );
}
