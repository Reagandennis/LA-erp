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

import type { AssessmentDetail } from './intel';
import { getAssessmentImage } from './intel';
import { getOrganizationLogo, getOrganizationSettings } from './organization';

const BRAND = '#03458f';

const RISK_COLORS: Record<string, string> = {
  Low: '#3f7d3f',
  Moderate: '#b8860b',
  High: '#c2410c',
  Extreme: '#b91c1c',
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: '#1f2937', fontFamily: 'Helvetica', lineHeight: 1.4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerLeft: { maxWidth: 300 },
  logo: { maxHeight: 46, maxWidth: 160, marginBottom: 6, objectFit: 'contain' },
  companyName: { fontSize: 13, fontWeight: 700, color: '#111827' },
  badge: { fontSize: 8, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4 },
  headerRight: { textAlign: 'right' },
  riskPill: { fontSize: 9, fontWeight: 700, color: '#ffffff', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4 },
  riskCaption: { fontSize: 7, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, textAlign: 'right' },
  title: { fontSize: 18, fontWeight: 700, color: '#111827', marginTop: 8 },
  metaLine: { fontSize: 9, color: '#6b7280', marginTop: 2 },
  rule: { borderTopWidth: 1, borderTopColor: '#e5e7eb', marginVertical: 14 },
  imagesRow: { flexDirection: 'row', gap: 10, marginVertical: 12 },
  imageWrap: { flex: 1 },
  reportImage: { width: '100%', height: 130, objectFit: 'cover', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  imageCaption: { fontSize: 7, color: '#9ca3af', marginTop: 3, textAlign: 'center' },
  sectionLabel: { fontSize: 8, color: BRAND, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginTop: 4 },
  summaryBox: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#eef2f7', borderRadius: 6, padding: 12, marginBottom: 8 },
  summaryText: { fontSize: 10, color: '#1f2937' },
  sectionBlock: { marginBottom: 10 },
  sectionHeading: { fontSize: 11, fontWeight: 700, color: '#111827', marginBottom: 3 },
  sectionBody: { fontSize: 9.5, color: '#374151' },
  recItem: { flexDirection: 'row', marginBottom: 5 },
  recBullet: { width: 12, color: BRAND, fontWeight: 700 },
  recText: { flex: 1, fontSize: 9.5, color: '#374151' },
  sourceItem: { fontSize: 8, color: '#6b7280', marginBottom: 3 },
  sourceUrl: { color: BRAND },
  disclaimer: { fontSize: 7.5, color: '#9ca3af', marginTop: 14, fontStyle: 'italic' },
  footer: { position: 'absolute', left: 40, right: 40, bottom: 24, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface IntelPdfProps {
  assessment: AssessmentDetail;
  companyName: string | null;
  logoDataUri: string | null;
  mapDataUri: string | null;
  streetDataUri: string | null;
  generatedOn: string;
}

function IntelPdfDocument({
  assessment,
  companyName,
  logoDataUri,
  mapDataUri,
  streetDataUri,
  generatedOn,
}: IntelPdfProps) {
  const riskColor = RISK_COLORS[assessment.riskLevel] ?? BRAND;
  const locationLine = assessment.formattedAddress ?? assessment.location;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoDataUri} style={styles.logo} />
            ) : null}
            {companyName ? <Text style={styles.companyName}>{companyName}</Text> : null}
            <Text style={styles.badge}>Security &amp; Travel-Risk Assessment</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.riskCaption}>Overall risk</Text>
            <Text style={[styles.riskPill, { backgroundColor: riskColor }]}>{assessment.riskLevel}</Text>
          </View>
        </View>

        <Text style={styles.title}>{assessment.title}</Text>
        <Text style={styles.metaLine}>{locationLine}</Text>
        <Text style={styles.metaLine}>Generated {generatedOn}</Text>

        {(mapDataUri || streetDataUri) && (
          <View style={styles.imagesRow}>
            {mapDataUri ? (
              <View style={styles.imageWrap}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={mapDataUri} style={styles.reportImage} />
                <Text style={styles.imageCaption}>Location map</Text>
              </View>
            ) : null}
            {streetDataUri ? (
              <View style={styles.imageWrap}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={streetDataUri} style={styles.reportImage} />
                <Text style={styles.imageCaption}>Street view</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.rule} />

        <Text style={styles.sectionLabel}>Executive summary</Text>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{assessment.summary}</Text>
        </View>

        {assessment.sections.map((s, i) => (
          <View key={i} style={styles.sectionBlock} wrap={false}>
            <Text style={styles.sectionHeading}>{s.heading}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}

        {assessment.recommendations.length > 0 && (
          <View wrap={false}>
            <View style={styles.rule} />
            <Text style={styles.sectionLabel}>Recommendations</Text>
            {assessment.recommendations.map((r, i) => (
              <View key={i} style={styles.recItem}>
                <Text style={styles.recBullet}>{'•'}</Text>
                <Text style={styles.recText}>{r}</Text>
              </View>
            ))}
          </View>
        )}

        {assessment.sources.length > 0 && (
          <View>
            <View style={styles.rule} />
            <Text style={styles.sectionLabel}>Sources</Text>
            {assessment.sources.map((src, i) => (
              <Text key={i} style={styles.sourceItem}>
                {i + 1}. {src.title} <Text style={styles.sourceUrl}>({src.url})</Text>
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.disclaimer}>
          This assessment is AI-generated from open-source information for operational planning and should be
          verified against authoritative government travel advisories before relying on it for safety-critical
          decisions.
        </Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `${assessment.title} · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

async function toPngDataUri(buffer: Buffer | null): Promise<string | null> {
  if (!buffer) return null;
  try {
    const png = await sharp(buffer).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Renders an Intel assessment to a branded PDF buffer. */
export async function buildIntelPdf(assessment: AssessmentDetail): Promise<Buffer> {
  const [organization, logo, mapImage, streetImage] = await Promise.all([
    getOrganizationSettings(),
    getOrganizationLogo(),
    assessment.hasMap ? getAssessmentImage(assessment.id, 'map') : Promise.resolve(null),
    assessment.hasStreet ? getAssessmentImage(assessment.id, 'street') : Promise.resolve(null),
  ]);

  const [logoDataUri, mapDataUri, streetDataUri] = await Promise.all([
    toPngDataUri(logo?.buffer ?? null),
    toPngDataUri(mapImage?.content ?? null),
    toPngDataUri(streetImage?.content ?? null),
  ]);

  return renderToBuffer(
    <IntelPdfDocument
      assessment={assessment}
      companyName={organization.companyName}
      logoDataUri={logoDataUri}
      mapDataUri={mapDataUri}
      streetDataUri={streetDataUri}
      generatedOn={formatDate(assessment.createdAt)}
    />,
  );
}
