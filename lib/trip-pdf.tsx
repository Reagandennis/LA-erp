import 'server-only';

import {
  Defs,
  Document,
  Font,
  G,
  Image,
  Link,
  LinearGradient,
  Page,
  Path,
  Rect,
  Stop,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import React from 'react';
import sharp from 'sharp';

import { CATEGORY_ICON_PATHS, type TripItemCategory } from '@/app/modules/trip-planning/[tripId]/categories';
import type {
  ClientItinerary,
  ClientItineraryDay,
  ClientItineraryItem,
} from '@/app/modules/trip-planning/[tripId]/client-itinerary';

import { APP_LOCALE } from './locale';
import type { BrandPdfInfo } from './quote-pdf';

/**
 * The client's itinerary as a PDF, laid out like the share page: a branded
 * header, then each day as a timeline. Helvetica only (react-pdf's built-in
 * font), so anything it can't draw, like the plane, is an SVG path instead.
 */

// Whole words only: react-pdf otherwise breaks a title as "Ex-ecutive". The
// setting is process-wide, so quotes and invoices stop hyphenating too.
Font.registerHyphenationCallback((word) => [word]);

/** Photos a stop shows in the PDF; more would make an emailed PDF heavy. The live link has them all. */
export const PDF_PHOTOS_PER_ITEM = 4;

/** The photos the PDF shows, so only those previews are loaded (lib/trip-attachments loadPdfPhotos). */
export function pdfPhotoIds(itinerary: ClientItinerary): number[] {
  return [...itinerary.days.flatMap((day) => day.items), ...itinerary.unscheduled].flatMap((item) =>
    item.attachments
      .filter((file) => file.isImage)
      .slice(0, PDF_PHOTOS_PER_ITEM)
      .map((file) => file.id),
  );
}

const PAGE_X = 36;
const TIME_WIDTH = 64;
const RAIL_WIDTH = 30;

const INK = '#111827';
const MUTED = '#6B7280';
const FAINT = '#9CA3AF';
const LINE = '#E5E7EB';
const TILE = '#F3F4F6';

/** The share page's category chips (Tailwind's 100/600 pairs), as colours react-pdf can use. */
const CATEGORY_COLORS: Record<TripItemCategory, { fg: string; bg: string } | 'accent'> = {
  flight: { fg: '#0284C7', bg: '#E0F2FE' },
  transportation: 'accent',
  lodging: { fg: '#7C3AED', bg: '#EDE9FE' },
  tour: { fg: '#059669', bg: '#D1FAE5' },
  booking: { fg: '#D97706', bg: '#FEF3C7' },
  activity: { fg: '#0D9488', bg: '#CCFBF1' },
  information: { fg: '#6B7280', bg: '#F3F4F6' },
};

const CHECK_PATH = 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z';

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: PAGE_X, fontSize: 9.5, color: INK, fontFamily: 'Helvetica' },

  // Header band, bled to the page edges on the first page.
  band: {
    marginTop: -36,
    marginHorizontal: -PAGE_X,
    paddingHorizontal: PAGE_X,
    paddingTop: 28,
    paddingBottom: 26,
    position: 'relative',
    overflow: 'hidden',
  },
  bandBackground: { position: 'absolute', top: 0, left: 0 },
  bandTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoBox: { backgroundColor: '#FFFFFF', borderRadius: 6, paddingVertical: 5, paddingHorizontal: 8 },
  logo: { height: 26, maxWidth: 130, objectFit: 'contain' },
  companyName: { color: '#FFFFFF', fontSize: 12, fontWeight: 700 },
  eyebrow: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  title: { marginTop: 22, color: '#FFFFFF', fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
  bandLine: { marginTop: 5, color: '#FFFFFF', opacity: 0.85, fontSize: 10 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 16 },
  stat: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 9 },
  statLabel: { color: '#FFFFFF', opacity: 0.7, fontSize: 6.5, letterSpacing: 1, textTransform: 'uppercase' },
  statValue: { color: '#FFFFFF', fontSize: 12, fontWeight: 700, marginTop: 2 },
  issued: { marginTop: 14, color: '#FFFFFF', opacity: 0.7, fontSize: 7.5 },

  // Days
  day: { marginTop: 22 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayBadge: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayBadgeLabel: { color: '#FFFFFF', opacity: 0.8, fontSize: 5.5, letterSpacing: 1, textTransform: 'uppercase' },
  dayBadgeNumber: { color: '#FFFFFF', fontSize: 14, fontWeight: 700, marginTop: 1 },
  dayHeading: { fontSize: 13, fontWeight: 700 },
  dayDate: { color: MUTED, marginTop: 1 },
  daySummary: { marginTop: 8, color: '#4B5563' },

  // Timeline rows
  row: { flexDirection: 'row', marginTop: 10 },
  timeCol: { width: TIME_WIDTH, paddingTop: 9, paddingRight: 6, alignItems: 'flex-end' },
  timeStart: { fontSize: 9.5, fontWeight: 700, textAlign: 'right' },
  timeEnd: { fontSize: 8, color: MUTED, marginTop: 1, textAlign: 'right' },
  timeLabel: { fontSize: 7, color: FAINT, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' },
  rail: { width: RAIL_WIDTH, alignItems: 'center', position: 'relative' },
  railLine: { position: 'absolute', top: 0, bottom: -10, left: RAIL_WIDTH / 2 - 0.5, width: 1, backgroundColor: LINE },
  dot: { marginTop: 7, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10, backgroundColor: '#FFFFFF' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { fontSize: 7, color: FAINT, textTransform: 'uppercase', letterSpacing: 1 },
  doneChip: { fontSize: 6.5, color: '#047857', backgroundColor: '#D1FAE5', borderRadius: 6, paddingVertical: 1.5, paddingHorizontal: 5, fontWeight: 700 },
  itemTitle: { fontSize: 11.5, fontWeight: 700, marginTop: 3, lineHeight: 1.25 },
  subtitle: { color: MUTED, marginTop: 2 },

  route: { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: '#F0F9FF', borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10 },
  routeCode: { fontSize: 16, fontWeight: 700 },
  routeLine: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 },
  routeDash: { flex: 1, borderTopWidth: 1, borderTopColor: '#BAE6FD', borderStyle: 'dashed' },

  info: { marginTop: 7, gap: 2.5 },
  infoLine: { flexDirection: 'row' },
  infoLabel: { color: MUTED, width: 84 },
  // Text with flex: 1 measures far too tall in react-pdf; the View takes the width instead.
  infoValueBox: { flex: 1 },
  infoValue: { color: '#1F2937' },
  link: { color: '#1F2937', textDecoration: 'none' },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  tile: { backgroundColor: TILE, borderRadius: 5, paddingVertical: 4, paddingHorizontal: 7 },
  confirmTile: { borderRadius: 5, paddingVertical: 3.5, paddingHorizontal: 7, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB' },
  tileLabel: { fontSize: 6, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.8 },
  tileValue: { fontSize: 9, fontWeight: 700, marginTop: 1.5 },
  code: { fontSize: 9, fontFamily: 'Courier-Bold', marginTop: 1.5, letterSpacing: 0.8 },

  // No lineHeight on these Texts: react-pdf leaves a blank line under short text that has one.
  notesBox: { marginTop: 8, borderLeftWidth: 2.5, backgroundColor: '#F9FAFB', paddingVertical: 6, paddingHorizontal: 8 },
  notes: { color: '#4B5563' },
  photos: { flexDirection: 'row', gap: 5, marginTop: 8 },
  // Four across the card's inner width.
  photo: { width: 97, height: 73, borderRadius: 5, objectFit: 'cover' },
  morePhotos: { marginTop: 4, fontSize: 7.5, color: MUTED },
  booking: { marginTop: 8, fontSize: 8.5, fontWeight: 700, textDecoration: 'none' },

  section: { marginTop: 22, fontSize: 13, fontWeight: 700 },
  sectionHint: { color: MUTED, marginTop: 2 },
  empty: { marginTop: 24, padding: 16, borderWidth: 1, borderColor: LINE, borderRadius: 8, color: MUTED, textAlign: 'center' },

  contact: { marginTop: 26, borderRadius: 10, padding: 16 },
  contactTitle: { color: '#FFFFFF', fontSize: 12.5, fontWeight: 700 },
  contactBody: { color: '#FFFFFF', opacity: 0.85, marginTop: 3 },
  contactRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  contactPill: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10, fontSize: 9, fontWeight: 700, textDecoration: 'none' },

  footer: {
    position: 'absolute',
    left: PAGE_X,
    right: PAGE_X,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 6,
    color: FAINT,
    fontSize: 7.5,
  },
});

// ── Colour and text helpers ──────────────────────────────────────────────────

/** Brand colours are typed in by admins; react-pdf needs a real one. */
function safeAccent(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join('')}`;
  return '#03458F';
}

/** `hex` moved `amount` (0–1) of the way to white (positive) or black (negative). */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const weight = Math.abs(amount);
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels
    .map((c) => Math.round(c + (target - c) * weight).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Helvetica has no arrows: "Base → JKIA" would print as "Base ’ JKIA". */
function withPdfGlyphs(itinerary: ClientItinerary): ClientItinerary {
  return JSON.parse(JSON.stringify(itinerary).replace(/→/g, '»').replace(/←/g, '«'));
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(APP_LOCALE, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function dateRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Dates to be confirmed';
  if (!start || !end || start === end) return formatDate(start ?? end);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function mapsHref(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Glyph({ path, color, size, rotate = 0 }: { path: string; color: string; size: number; rotate?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform={rotate ? `rotate(${rotate} 12 12)` : undefined}>
        <Path d={path} fill={color} />
      </G>
    </Svg>
  );
}

function Header({ itinerary, brand, logoDataUri, accent }: { itinerary: ClientItinerary; brand: BrandPdfInfo; logoDataUri: string | null; accent: string }) {
  const stops = itinerary.days.reduce((count, day) => count + day.items.length, itinerary.unscheduled.length);
  const preparedFor = [itinerary.customer.company, itinerary.customer.name].filter(Boolean).join(' · ');
  const stats = [
    { label: itinerary.days.length === 1 ? 'Day' : 'Days', value: String(itinerary.days.length) },
    { label: stops === 1 ? 'Stop' : 'Stops', value: String(stops) },
    { label: 'Reference', value: itinerary.reference },
  ];
  const issued = new Date().toLocaleString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <View style={styles.band}>
      {/* As wide as A4 and taller than the band gets; the band clips what's left over. */}
      <Svg style={styles.bandBackground} width={595.28} height={480} viewBox="0 0 595.28 480" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="band" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={shade(accent, 0.12)} />
            <Stop offset="1" stopColor={shade(accent, -0.35)} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="595.28" height="480" fill="url(#band)" />
        <Rect x="440" y="-90" width="220" height="220" rx="110" fill="#FFFFFF" fillOpacity={0.07} />
      </Svg>

      <View style={styles.bandTop}>
        {logoDataUri ? (
          <View style={styles.logoBox}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={logoDataUri} style={styles.logo} />
          </View>
        ) : (
          <Text style={styles.companyName}>{brand.companyName ?? ''}</Text>
        )}
        <Text style={styles.eyebrow}>Itinerary</Text>
      </View>

      <Text style={styles.title}>{itinerary.title}</Text>
      <Text style={styles.bandLine}>{dateRange(itinerary.startDate, itinerary.endDate)}</Text>
      {itinerary.travelers.length > 0 ? (
        <Text style={styles.bandLine}>Travellers: {itinerary.travelers.join(', ')}</Text>
      ) : null}
      {preparedFor ? <Text style={styles.bandLine}>Prepared for {preparedFor}</Text> : null}

      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.issued}>Issued {issued}. Plans can change: check with your team for the latest.</Text>
    </View>
  );
}

function DayHeader({ day, accent }: { day: ClientItineraryDay; accent: string }) {
  // "Saturday" over "Sep 26", unless the planner named the day.
  const [weekday, monthDay] = day.date.split(', ');
  const heading = day.title ?? (weekday || `Day ${day.dayNumber}`);
  const subheading = day.title ? day.date : monthDay;
  return (
    <View style={styles.dayHeader} wrap={false} minPresenceAhead={90}>
      <View style={[styles.dayBadge, { backgroundColor: accent }]}>
        <Text style={styles.dayBadgeLabel}>Day</Text>
        <Text style={styles.dayBadgeNumber}>{day.dayNumber}</Text>
      </View>
      <View>
        <Text style={styles.dayHeading}>{heading}</Text>
        {subheading ? <Text style={styles.dayDate}>{subheading}</Text> : null}
      </View>
    </View>
  );
}

function InfoLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueBox}>
        <Text style={styles.infoValue}>{children}</Text>
      </View>
    </View>
  );
}

const FLIGHT_ROUTE_KEYS = new Set(['departAirport', 'arriveAirport']);

/** JPEG data URIs by attachment id. A photo missing here (no preview) is left out. */
type Photos = Map<number, string>;

function ItemRow({ item, accent, last, photos }: { item: ClientItineraryItem; accent: string; last: boolean; photos: Photos }) {
  const palette = CATEGORY_COLORS[item.category];
  const colors = palette === 'accent' ? { fg: accent, bg: shade(accent, 0.88) } : palette;
  const [start, end] = item.time.split(' – ');
  const from = item.details.find((detail) => detail.key === 'departAirport')?.value;
  const to = item.details.find((detail) => detail.key === 'arriveAirport')?.value;
  const route = item.category === 'flight' && from && to ? { from, to } : null;
  const tiles = item.details.filter((detail) => !route || !FLIGHT_ROUTE_KEYS.has(detail.key));
  const place = [item.place, item.address].filter(Boolean).join(', ');
  const images = item.attachments.filter((file) => file.isImage);
  const shownPhotos = images.slice(0, PDF_PHOTOS_PER_ITEM).filter((file) => photos.has(file.id));
  const morePhotos = images.length - Math.min(images.length, PDF_PHOTOS_PER_ITEM);

  return (
    <View style={styles.row} wrap={false}>
      <View style={styles.timeCol}>
        {start ? <Text style={[styles.timeStart, { color: accent }]}>{start}</Text> : null}
        {end ? <Text style={styles.timeEnd}>to {end}</Text> : null}
        {item.timeLabel ? <Text style={styles.timeLabel}>{item.timeLabel}</Text> : null}
      </View>

      <View style={styles.rail}>
        {last ? null : <View style={styles.railLine} />}
        <View style={[styles.dot, { backgroundColor: item.done ? '#10B981' : colors.bg }]}>
          <Glyph path={item.done ? CHECK_PATH : CATEGORY_ICON_PATHS[item.category]} color={item.done ? '#FFFFFF' : colors.fg} size={12} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.category}>{item.categoryLabel}</Text>
          {item.done ? <Text style={styles.doneChip}>DONE</Text> : null}
        </View>
        <Text style={styles.itemTitle}>{item.title}</Text>
        {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}

        {route ? (
          <View style={styles.route}>
            <Text style={styles.routeCode}>{route.from}</Text>
            <View style={styles.routeLine}>
              <View style={styles.routeDash} />
              <Glyph path={CATEGORY_ICON_PATHS.flight} color="#0EA5E9" size={13} rotate={90} />
              <View style={styles.routeDash} />
            </View>
            <Text style={styles.routeCode}>{route.to}</Text>
          </View>
        ) : null}

        {item.provider || place || item.phone || item.crew.length > 0 || item.vehicle ? (
          <View style={styles.info}>
            {item.provider ? <InfoLine label={item.provider.label}>{item.provider.name}</InfoLine> : null}
            {place ? (
              <InfoLine label="Where">
                <Link src={mapsHref(place)} style={styles.link}>
                  {place}
                </Link>
              </InfoLine>
            ) : null}
            {item.phone ? (
              <InfoLine label="Phone">
                <Link src={telHref(item.phone)} style={styles.link}>
                  {item.phone}
                </Link>
              </InfoLine>
            ) : null}
            {item.crew.map((member) => (
              <InfoLine key={member.role} label={member.role}>
                {member.name}
                {member.phone ? '  ·  ' : ''}
                {member.phone ? (
                  <Link src={telHref(member.phone)} style={styles.link}>
                    {member.phone}
                  </Link>
                ) : null}
              </InfoLine>
            ))}
            {item.vehicle ? <InfoLine label="Vehicle">{item.vehicle}</InfoLine> : null}
          </View>
        ) : null}

        {tiles.length > 0 || item.confirmationCode ? (
          <View style={styles.tiles}>
            {tiles.map((detail) => (
              <View key={detail.key} style={styles.tile}>
                <Text style={styles.tileLabel}>{detail.label}</Text>
                <Text style={styles.tileValue}>{detail.value}</Text>
              </View>
            ))}
            {item.confirmationCode ? (
              <View style={styles.confirmTile}>
                <Text style={styles.tileLabel}>Confirmation</Text>
                <Text style={styles.code}>{item.confirmationCode}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {shownPhotos.length > 0 ? (
          <View style={styles.photos}>
            {shownPhotos.map((file) => (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image key={file.id} src={photos.get(file.id)!} style={styles.photo} />
            ))}
          </View>
        ) : null}
        {morePhotos > 0 ? (
          <Text style={styles.morePhotos}>
            +{morePhotos} more photo{morePhotos === 1 ? '' : 's'}
          </Text>
        ) : null}

        {item.notes ? (
          <View style={[styles.notesBox, { borderLeftColor: accent }]}>
            <Text style={styles.notes}>{item.notes}</Text>
          </View>
        ) : null}
        {item.bookingUrl ? (
          <Link src={item.bookingUrl} style={[styles.booking, { color: accent }]}>
            Booking details »
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function Timeline({ items, accent, photos }: { items: ClientItineraryItem[]; accent: string; photos: Photos }) {
  return (
    <View>
      {items.map((item, index) => (
        <ItemRow key={item.id} item={item} accent={accent} last={index === items.length - 1} photos={photos} />
      ))}
    </View>
  );
}

function Contact({ brand, accent }: { brand: BrandPdfInfo; accent: string }) {
  if (!brand.phone && !brand.email) return null;
  return (
    <View style={[styles.contact, { backgroundColor: accent }]} wrap={false}>
      <Text style={styles.contactTitle}>Need anything during your trip?</Text>
      <Text style={styles.contactBody}>Your team at {brand.companyName ?? 'our office'} is a call away.</Text>
      <View style={styles.contactRow}>
        {brand.phone ? (
          <Link src={telHref(brand.phone)} style={[styles.contactPill, { color: accent }]}>
            {brand.phone}
          </Link>
        ) : null}
        {brand.email ? (
          <Link src={`mailto:${brand.email}`} style={[styles.contactPill, { color: accent }]}>
            {brand.email}
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function TripItineraryDocument({
  itinerary,
  brand,
  logoDataUri,
  photos,
}: {
  itinerary: ClientItinerary;
  brand: BrandPdfInfo;
  logoDataUri: string | null;
  photos: Photos;
}) {
  const accent = safeAccent(brand.primaryColor);
  const isEmpty = itinerary.days.length === 0 && itinerary.unscheduled.length === 0;

  return (
    <Document title={`${itinerary.reference} itinerary`} author={brand.companyName ?? undefined}>
      <Page size="A4" style={styles.page}>
        <Header itinerary={itinerary} brand={brand} logoDataUri={logoDataUri} accent={accent} />

        {itinerary.days.map((day) => (
          <View key={day.id} style={styles.day}>
            <DayHeader day={day} accent={accent} />
            {day.summary ? <Text style={styles.daySummary}>{day.summary}</Text> : null}
            <Timeline items={day.items} accent={accent} photos={photos} />
          </View>
        ))}

        {itinerary.unscheduled.length > 0 ? (
          <View>
            <View wrap={false} minPresenceAhead={90}>
              <Text style={styles.section}>Still to be scheduled</Text>
              <Text style={styles.sectionHint}>Confirmed, with a time to follow.</Text>
            </View>
            <Timeline items={itinerary.unscheduled} accent={accent} photos={photos} />
          </View>
        ) : null}

        {isEmpty ? <Text style={styles.empty}>The itinerary is still being put together.</Text> : null}

        <Contact brand={brand} accent={accent} />

        <View style={styles.footer} fixed>
          <Text>
            {brand.companyName ? `${brand.companyName}  •  ` : ''}
            {itinerary.reference}  •  {itinerary.title}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderTripItineraryPdf(input: {
  itinerary: ClientItinerary;
  brand: BrandPdfInfo;
  logo: { buffer: Buffer; mimeType: string } | null;
  /** From loadPdfPhotos; without it the PDF has no photos. */
  photos?: Photos;
}): Promise<Buffer> {
  let logoDataUri: string | null = null;
  if (input.logo) {
    try {
      // react-pdf can't draw every format (SVG among them); PNG it can.
      const png = await sharp(input.logo.buffer).png().toBuffer();
      logoDataUri = `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      // A broken logo shouldn't cost the client their itinerary.
      logoDataUri = null;
    }
  }

  return renderToBuffer(
    <TripItineraryDocument
      itinerary={withPdfGlyphs(input.itinerary)}
      brand={input.brand}
      logoDataUri={logoDataUri}
      photos={input.photos ?? new Map()}
    />,
  );
}
