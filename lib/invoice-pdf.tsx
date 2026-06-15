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

import type { InvoiceDetail } from './invoices';
import type { BrandPdfInfo } from './quote-pdf';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: '#111827', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { maxWidth: 240 },
  logo: { maxHeight: 60, maxWidth: 180, marginBottom: 6, objectFit: 'contain' },
  companyName: { fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 4 },
  companyMetaLine: { color: '#6B7280', fontSize: 9, marginTop: 1 },
  headerRight: { textAlign: 'right', minWidth: 210 },
  badge: { fontSize: 9, color: '#03458f', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  reference: { fontSize: 18, fontWeight: 700, color: '#111827' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 8 },
  metaCell: { textAlign: 'right' },
  metaLabel: { color: '#6B7280', textTransform: 'uppercase', fontSize: 8, letterSpacing: 1 },
  metaValue: { color: '#111827', fontWeight: 700, marginTop: 2 },
  blocksRow: { flexDirection: 'row', gap: 16, marginTop: 24, alignItems: 'stretch' },
  block: { flex: 1, padding: 12, borderRadius: 6, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  blockTitle: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  blockLine: { color: '#1F2937', fontSize: 10, marginTop: 1 },
  balanceBox: { flex: 1, padding: 14, borderRadius: 6, justifyContent: 'center' },
  balanceLabel: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: '#FFFFFF', opacity: 0.85 },
  balanceValue: { fontSize: 20, fontWeight: 700, color: '#FFFFFF', marginTop: 4 },
  balanceMeta: { fontSize: 8, color: '#FFFFFF', opacity: 0.85, marginTop: 4 },
  itemsTable: { marginTop: 24 },
  itemsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    paddingVertical: 8,
  },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  colDescription: { flex: 4, paddingHorizontal: 6 },
  colQty: { flex: 1, paddingHorizontal: 6, textAlign: 'right' },
  colUnit: { flex: 1.5, paddingHorizontal: 6, textAlign: 'right' },
  colTotal: { flex: 1.5, paddingHorizontal: 6, textAlign: 'right', fontWeight: 700 },
  headerText: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 },
  cellText: { color: '#111827' },
  totalsBox: {
    marginTop: 16,
    alignSelf: 'flex-end',
    width: 240,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { color: '#6B7280' },
  totalsValue: { color: '#111827', fontWeight: 700 },
  grandTotalLabel: { color: '#111827', fontWeight: 700, fontSize: 12 },
  grandTotalValue: { color: '#111827', fontWeight: 700, fontSize: 13 },
  balanceDueLabel: { fontWeight: 700, fontSize: 12 },
  balanceDueValue: { fontWeight: 700, fontSize: 14 },
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
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = ' ') {
  return parts.filter((part) => part && part.trim().length > 0).join(separator);
}

function buildCompanyAddressLines(brand: BrandPdfInfo): string[] {
  const cityLine = joinNonEmpty([brand.city, brand.region, brand.postalCode], ' ');
  return [brand.addressLine1, brand.addressLine2, cityLine, brand.country].filter(
    (l): l is string => Boolean(l && l.trim()),
  );
}

interface InvoicePdfProps {
  invoice: InvoiceDetail;
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

function InvoicePdfDocument({ invoice, brand, taxLabel, logoDataUri, customer }: InvoicePdfProps) {
  const currency = invoice.currency;
  const addressLines = buildCompanyAddressLines(brand);
  const accent = brand.primaryColor;

  const billToLines = [customer.company, customer.name, customer.email, customer.billingAddress].filter(
    (l): l is string => Boolean(l),
  );
  const shipToLines = [customer.address ?? customer.billingAddress].filter((l): l is string => Boolean(l));

  const statusLabel = invoice.isOverdue ? 'Overdue' : invoice.status;
  const fullyPaid = invoice.balanceDue <= 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoDataUri} style={styles.logo} />
            ) : null}
            {brand.companyName ? <Text style={styles.companyName}>{brand.companyName}</Text> : null}
            {addressLines.map((line, i) => (
              <Text key={i} style={styles.companyMetaLine}>{line}</Text>
            ))}
            {brand.email ? <Text style={styles.companyMetaLine}>{brand.email}</Text> : null}
            {brand.phone ? <Text style={styles.companyMetaLine}>{brand.phone}</Text> : null}
            {brand.website ? <Text style={styles.companyMetaLine}>{brand.website}</Text> : null}
          </View>

          <View style={styles.headerRight}>
            <Text style={[styles.badge, { color: accent }]}>Invoice</Text>
            <Text style={styles.reference}>{invoice.number}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Issue date</Text>
                <Text style={styles.metaValue}>{formatDate(invoice.issueDate)}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Due date</Text>
                <Text style={styles.metaValue}>{formatDate(invoice.dueDate)}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Status</Text>
                <Text style={styles.metaValue}>{statusLabel}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Currency</Text>
                <Text style={styles.metaValue}>{currency}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.blocksRow}>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Bill to</Text>
            {billToLines.length > 0 ? (
              billToLines.map((line, i) => <Text key={i} style={styles.blockLine}>{line}</Text>)
            ) : (
              <Text style={styles.blockLine}>—</Text>
            )}
          </View>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Ship to</Text>
            {shipToLines.length > 0 ? (
              shipToLines.map((line, i) => <Text key={i} style={styles.blockLine}>{line}</Text>)
            ) : (
              <Text style={styles.blockLine}>—</Text>
            )}
          </View>
          <View style={[styles.balanceBox, { backgroundColor: fullyPaid ? '#059669' : accent }]}>
            <Text style={styles.balanceLabel}>{fullyPaid ? 'Paid in full' : 'Balance due'}</Text>
            <Text style={styles.balanceValue}>{formatMoney(invoice.balanceDue, currency)}</Text>
            <Text style={styles.balanceMeta}>Due {formatDate(invoice.dueDate)}</Text>
          </View>
        </View>

        <View style={styles.itemsTable}>
          <View style={[styles.itemsHeader, { borderBottomColor: accent }]}>
            <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
            <Text style={[styles.colQty, styles.headerText]}>Days</Text>
            <Text style={[styles.colUnit, styles.headerText]}>Unit</Text>
            <Text style={[styles.colTotal, styles.headerText]}>Amount</Text>
          </View>
          {invoice.items.map((item) => (
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

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatMoney(invoice.subtotal, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              {taxLabel} ({(invoice.taxRate * 100).toFixed(2)}%)
            </Text>
            <Text style={styles.totalsValue}>{formatMoney(invoice.tax, currency)}</Text>
          </View>
          {invoice.discountType !== 'none' && invoice.discountAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Discount</Text>
              <Text style={styles.totalsValue}>- {formatMoney(invoice.discountAmount, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.totalsRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{formatMoney(invoice.total, currency)}</Text>
          </View>
          {invoice.amountPaid > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Amount paid</Text>
              <Text style={styles.totalsValue}>- {formatMoney(invoice.amountPaid, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.totalsRow}>
            <Text style={[styles.balanceDueLabel, { color: accent }]}>Balance due</Text>
            <Text style={[styles.balanceDueValue, { color: accent }]}>
              {formatMoney(invoice.balanceDue, currency)}
            </Text>
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesBody}>{invoice.notes}</Text>
          </View>
        ) : null}
        {invoice.terms ? (
          <View style={styles.termsBox}>
            <Text style={styles.termsTitle}>Terms & conditions</Text>
            <Text style={styles.termsBody}>{invoice.terms}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {brand.companyName ?? ''}  •  {invoice.number}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(input: {
  invoice: InvoiceDetail;
  brand: BrandPdfInfo;
  taxLabel: string;
  logo: { buffer: Buffer; mimeType: string } | null;
  customer: InvoicePdfProps['customer'];
}): Promise<Buffer> {
  let logoDataUri: string | null = null;
  if (input.logo) {
    try {
      const pngBuffer = await sharp(input.logo.buffer).png().toBuffer();
      logoDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch {
      logoDataUri = null;
    }
  }

  return renderToBuffer(
    <InvoicePdfDocument
      invoice={input.invoice}
      brand={input.brand}
      taxLabel={input.taxLabel}
      logoDataUri={logoDataUri}
      customer={input.customer}
    />,
  );
}
