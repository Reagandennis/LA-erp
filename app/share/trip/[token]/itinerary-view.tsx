import type { ReactNode } from 'react';

import { CATEGORY_ICON_PATHS, categoryMeta } from '@/app/modules/trip-planning/[tripId]/categories';
import type {
  ClientItinerary,
  ClientItineraryAttachment,
  ClientItineraryDay,
  ClientItineraryItem,
} from '@/app/modules/trip-planning/[tripId]/client-itinerary';
import { parseDateKey } from '@/lib/date-grid';
import { isInlineSafe } from '@/lib/file-response';
import { APP_LOCALE } from '@/lib/locale';

/**
 * The client's itinerary page. Server-rendered with no client script: it has
 * to open fast on a phone in an airport, and the token in the URL is its only
 * key, so there is nothing to hydrate.
 */

export interface ShareBrand {
  companyName: string | null;
  phone: string | null;
  email: string | null;
  /** A validated hex colour. */
  accent: string;
  logoSrc: string | null;
}

interface ViewContext {
  token: string;
  accent: string;
  /** The first stop still ahead, highlighted as "Up next". */
  nextItemId: number | null;
  todayKey: string;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatDate(value: string | null, withWeekday = false): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(APP_LOCALE, {
    weekday: withWeekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dateRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Dates to be confirmed';
  if (!start || !end || start === end) return formatDate(start ?? end, true);
  return `${formatDate(start, true)} – ${formatDate(end, true)}`;
}

/** "Sat 26" for the day pills. */
function pillDate(dateKey: string | null): string {
  const date = parseDateKey(dateKey);
  // Built by hand: en-US puts the day first ("20 Tue") when asked for only these two parts.
  return date ? `${date.toLocaleDateString(APP_LOCALE, { weekday: 'short' })} ${date.getDate()}` : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function mapsHref(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function fileHref(token: string, file: ClientItineraryAttachment, thumbnail = false): string {
  const base = `/api/share/trip/${token}/attachments/${file.id}`;
  if (thumbnail) return `${base}?thumb=1`;
  // Office files can't open in a browser tab; asking for a download says so up front.
  return isInlineSafe(file.mimeType) ? base : `${base}?download=1`;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const STROKE_ICONS = {
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  pin: 'M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
  phone:
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  building:
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  shield:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  car: 'M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM4 17H3V11l2-5h10l4 5h1a1 1 0 011 1v5h-1M8 17h8M5 11h14',
  check: 'M5 13l4 4L19 7',
  external: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
} as const;

function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof STROKE_ICONS; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={STROKE_ICONS[name]} />
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ItineraryView({
  itinerary,
  brand,
  token,
  now,
  todayKey,
}: {
  itinerary: ClientItinerary;
  brand: ShareBrand;
  token: string;
  now: Date;
  todayKey: string;
}) {
  const allItems = [...itinerary.days.flatMap((day) => day.items), ...itinerary.unscheduled];
  const next = allItems.find((item) => !item.done && item.startsAt && new Date(item.startsAt) > now);
  const context: ViewContext = { token, accent: brand.accent, nextItemId: next?.id ?? null, todayKey };
  const isEmpty = allItems.length === 0 && itinerary.days.length === 0;

  return (
    <div className="min-h-screen w-full bg-[#f5f6f8] text-gray-900">
      <Hero itinerary={itinerary} brand={brand} token={token} stops={allItems.length} />

      {itinerary.days.length > 1 && <DayNav days={itinerary.days} context={context} />}

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        {itinerary.days.map((day) => (
          <DaySection key={day.id} day={day} context={context} />
        ))}

        {itinerary.unscheduled.length > 0 && (
          <section className="pt-10">
            <h2 className="text-xl font-bold">Still to be scheduled</h2>
            <p className="mt-1 text-sm text-gray-500">Confirmed, with a time to follow.</p>
            <Timeline items={itinerary.unscheduled} context={context} />
          </section>
        )}

        {isEmpty && (
          <div className="mt-10 rounded-3xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <p className="text-lg font-semibold">Your itinerary is being put together</p>
            <p className="mt-1 text-sm text-gray-500">Check back soon; this page fills in as plans are confirmed.</p>
          </div>
        )}

        <ContactCard brand={brand} />

        <p className="mt-6 text-center text-xs text-gray-400">
          This page follows your plans as they change. Refresh for the latest (as of{' '}
          {now.toLocaleTimeString(APP_LOCALE, { hour: 'numeric', minute: '2-digit' })}).
        </p>
      </main>
    </div>
  );
}

function Hero({
  itinerary,
  brand,
  token,
  stops,
}: {
  itinerary: ClientItinerary;
  brand: ShareBrand;
  token: string;
  stops: number;
}) {
  const stats = [
    { label: itinerary.days.length === 1 ? 'Day' : 'Days', value: String(itinerary.days.length) },
    { label: stops === 1 ? 'Stop' : 'Stops', value: String(stops) },
    { label: 'Reference', value: itinerary.reference },
  ];
  return (
    <header className="relative overflow-hidden text-white" style={{ backgroundColor: brand.accent }}>
      <div className="absolute inset-0 bg-linear-to-br from-white/15 via-transparent to-black/45" aria-hidden="true" />
      <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-white/10" aria-hidden="true" />
      <div className="absolute -bottom-40 right-16 h-72 w-72 rounded-full bg-white/5" aria-hidden="true" />

      <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6 sm:pb-14 sm:pt-8">
        <div className="flex items-center justify-between gap-4">
          {brand.logoSrc ? (
            <span className="inline-flex rounded-xl bg-white px-3 py-2 shadow-sm">
              {/* A data URI from our own database; next/image adds nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoSrc} alt={brand.companyName ?? 'Logo'} className="h-8 max-w-[150px] object-contain" />
            </span>
          ) : (
            <p className="truncate text-base font-bold tracking-tight">{brand.companyName}</p>
          )}
          <a
            href={`/api/share/trip/${token}/pdf`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-white/90"
            style={{ color: brand.accent }}
          >
            <Icon name="download" />
            <span>PDF</span>
          </a>
        </div>

        <div className="mt-10 sm:mt-14">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-white/25">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live itinerary
          </span>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{itinerary.title}</h1>
          <p className="mt-2 text-base text-white/80">{dateRange(itinerary.startDate, itinerary.endDate)}</p>

          {itinerary.travelers.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Travellers">
              {itinerary.travelers.map((name, index) => (
                <li
                  key={`${name}-${index}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm ring-1 ring-white/20"
                >
                  <Icon name="person" className="h-3.5 w-3.5 text-white/70" />
                  {name}
                </li>
              ))}
            </ul>
          )}

          {/* The reference gets the room: trip references run long. */}
          <dl className="mt-8 grid max-w-lg grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.2fr)] gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0 rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-white/60">{stat.label}</dt>
                <dd className="mt-0.5 truncate text-base font-bold sm:text-lg" title={stat.value}>
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </header>
  );
}

function DayNav({ days, context }: { days: ClientItineraryDay[]; context: ViewContext }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-gray-200/70 bg-white/85 backdrop-blur" aria-label="Days">
      <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-6">
        {days.map((day) => {
          const today = day.dateKey === context.todayKey;
          return (
            <a
              key={day.id}
              href={`#day-${day.id}`}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                today ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={today ? { backgroundColor: context.accent } : undefined}
            >
              Day {day.dayNumber}
              {day.dateKey && <span className={today ? 'text-white/75' : 'text-gray-400'}> · {pillDate(day.dateKey)}</span>}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function DaySection({ day, context }: { day: ClientItineraryDay; context: ViewContext }) {
  const today = day.dateKey === context.todayKey;
  // "Saturday" over "Sep 26", unless the planner named the day.
  const [weekday, monthDay] = day.date.split(', ');
  const heading = day.title ?? (weekday || `Day ${day.dayNumber}`);
  const subheading = day.title ? day.date : monthDay;
  return (
    <section id={`day-${day.id}`} className="scroll-mt-16 pt-10">
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ backgroundColor: context.accent }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/75">Day</span>
          <span className="text-xl font-bold leading-none">{day.dayNumber}</span>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{heading}</h2>
          {subheading && <p className="text-sm text-gray-500">{subheading}</p>}
        </div>
        {today && (
          <span className="ml-auto shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            Today
          </span>
        )}
      </div>
      {day.summary && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-gray-600">{day.summary}</p>}
      {day.items.length > 0 && <Timeline items={day.items} context={context} />}
    </section>
  );
}

function Timeline({ items, context }: { items: ClientItineraryItem[]; context: ViewContext }) {
  return (
    <ol className="relative mt-6 space-y-4 before:absolute before:bottom-6 before:left-5 before:top-6 before:w-px before:bg-gray-200">
      {items.map((item) => (
        <TimelineItem key={item.id} item={item} context={context} />
      ))}
    </ol>
  );
}

function TimelineItem({ item, context }: { item: ClientItineraryItem; context: ViewContext }) {
  const isNext = item.id === context.nextItemId;
  const meta = categoryMeta(item.category);
  const route = item.category === 'flight' ? flightRoute(item) : null;
  const facts = item.details.filter((detail) => !route || !FLIGHT_ROUTE_KEYS.has(detail.key));

  return (
    <li className="relative pl-14">
      <span
        className={`absolute left-0 top-4 flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-[#f5f6f8] ${
          item.done ? 'bg-emerald-500 text-white' : meta.chip
        }`}
        title={item.categoryLabel}
      >
        {item.done ? (
          <Icon name="check" className="h-5 w-5" />
        ) : (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d={CATEGORY_ICON_PATHS[item.category]} />
          </svg>
        )}
      </span>

      <article
        className={`rounded-2xl border bg-white shadow-sm ${isNext ? 'border-transparent' : 'border-gray-100'} ${
          item.done ? 'opacity-75' : ''
        }`}
        style={isNext ? { boxShadow: `0 0 0 2px ${context.accent}, 0 10px 25px -12px ${context.accent}` } : undefined}
      >
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wider">
            {item.when && <span style={{ color: context.accent }}>{item.when}</span>}
            {item.when && <span className="text-gray-300">•</span>}
            <span className="text-gray-400">{item.categoryLabel}</span>
            {isNext && (
              <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] text-white" style={{ backgroundColor: context.accent }}>
                Up next
              </span>
            )}
            {item.done && (
              <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">Done</span>
            )}
          </div>

          <h3 className="mt-1.5 text-lg font-semibold leading-snug">{item.title}</h3>
          {item.subtitle && <p className="mt-0.5 text-sm text-gray-500">{item.subtitle}</p>}
          {item.travelers.length > 0 && (
            <p className="mt-1 text-sm text-gray-500">
              For <span className="font-medium text-gray-700">{item.travelers.join(', ')}</span>
            </p>
          )}

          {route && <FlightRoute from={route.from} to={route.to} />}

          <InfoRows item={item} />

          {(facts.length > 0 || item.confirmationCode) && (
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {facts.map((detail) => (
                <div key={detail.key} className="min-w-0 rounded-xl bg-gray-50 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{detail.label}</dt>
                  <dd className="mt-0.5 truncate text-sm font-semibold" title={detail.value}>
                    {detail.value}
                  </dd>
                </div>
              ))}
              {item.confirmationCode && (
                <div className="min-w-0 rounded-xl border border-dashed border-gray-300 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Confirmation</dt>
                  <dd className="mt-0.5 truncate font-mono text-sm font-semibold tracking-wider">{item.confirmationCode}</dd>
                </div>
              )}
            </dl>
          )}

          {item.notes && (
            <p
              className="mt-4 whitespace-pre-line rounded-r-xl border-l-4 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600"
              style={{ borderColor: context.accent }}
            >
              {item.notes}
            </p>
          )}

          {item.attachments.length > 0 && <Attachments files={item.attachments} context={context} />}

          {item.bookingUrl && (
            <a
              href={item.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ backgroundColor: context.accent }}
            >
              Booking details
              <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </article>
    </li>
  );
}

const FLIGHT_ROUTE_KEYS = new Set(['departAirport', 'arriveAirport']);

function flightRoute(item: ClientItineraryItem): { from: string; to: string } | null {
  const from = item.details.find((detail) => detail.key === 'departAirport')?.value;
  const to = item.details.find((detail) => detail.key === 'arriveAirport')?.value;
  return from && to ? { from, to } : null;
}

function FlightRoute({ from, to }: { from: string; to: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-sky-50 px-4 py-3">
      <span className="text-2xl font-bold tracking-tight">{from}</span>
      <span className="relative flex flex-1 items-center">
        <span className="h-px w-full border-t-2 border-dashed border-sky-200" />
        <svg
          className="absolute left-1/2 h-5 w-5 -translate-x-1/2 rotate-90 bg-sky-50 text-sky-500"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d={CATEGORY_ICON_PATHS.flight} />
        </svg>
      </span>
      <span className="text-2xl font-bold tracking-tight">{to}</span>
    </div>
  );
}

function InfoRow({ icon, children }: { icon: keyof typeof STROKE_ICONS; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-sm text-gray-700">
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const LINK = 'underline decoration-gray-300 underline-offset-2 hover:text-gray-900';

function InfoRows({ item }: { item: ClientItineraryItem }) {
  const place = [item.place, item.address].filter(Boolean).join(', ');
  if (!item.provider && !place && !item.phone && item.crew.length === 0 && !item.vehicle) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {item.provider && (
        <InfoRow icon="building">
          <span className="text-gray-500">{item.provider.label}:</span> {item.provider.name}
        </InfoRow>
      )}
      {place && (
        <InfoRow icon="pin">
          <a href={mapsHref(place)} target="_blank" rel="noopener noreferrer" className={LINK}>
            {place}
          </a>
        </InfoRow>
      )}
      {item.phone && (
        <InfoRow icon="phone">
          <a href={telHref(item.phone)} className={LINK}>
            {item.phone}
          </a>
        </InfoRow>
      )}
      {item.crew.map((member) => (
        <InfoRow key={member.role} icon={member.role === 'Driver' ? 'person' : 'shield'}>
          <span className="text-gray-500">{member.role}:</span> {member.name}
          {member.phone && (
            <>
              {' · '}
              <a href={telHref(member.phone)} className={LINK}>
                {member.phone}
              </a>
            </>
          )}
        </InfoRow>
      ))}
      {item.vehicle && (
        <InfoRow icon="car">
          <span className="text-gray-500">Vehicle:</span> {item.vehicle}
        </InfoRow>
      )}
    </div>
  );
}

/** Coloured like the file type, so a PDF ticket is easy to spot among photos. */
function fileBadge(file: ClientItineraryAttachment): { label: string; className: string } {
  const extension = file.filename.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE';
  if (file.mimeType === 'application/pdf') return { label: 'PDF', className: 'bg-rose-50 text-rose-600' };
  if (/word/.test(file.mimeType)) return { label: extension, className: 'bg-blue-50 text-blue-600' };
  if (/sheet|excel|csv/.test(file.mimeType)) return { label: extension, className: 'bg-emerald-50 text-emerald-600' };
  if (/presentation|powerpoint/.test(file.mimeType)) return { label: extension, className: 'bg-orange-50 text-orange-600' };
  return { label: extension, className: 'bg-gray-100 text-gray-600' };
}

function Attachments({ files, context }: { files: ClientItineraryAttachment[]; context: ViewContext }) {
  const images = files.filter((file) => file.isImage);
  const documents = files.filter((file) => !file.isImage);
  return (
    <div className="mt-4 space-y-2">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((file) => (
            <a
              key={file.id}
              href={fileHref(context.token, file)}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block aspect-square overflow-hidden rounded-xl bg-gray-100"
              title={file.filename}
            >
              {/* Served by our own token-checked route; next/image would cache it beyond the link's life. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileHref(context.token, file, true)}
                alt={file.filename}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            </a>
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((file) => {
            const badge = fileBadge(file);
            const opens = isInlineSafe(file.mimeType);
            return (
              <li key={file.id}>
                <a
                  href={fileHref(context.token, file)}
                  target={opens ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 transition hover:border-gray-200 hover:bg-gray-50"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{file.filename}</span>
                    <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: context.accent }}>
                    {opens ? 'View' : 'Download'}
                    <Icon name={opens ? 'external' : 'download'} className="h-3.5 w-3.5" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ContactCard({ brand }: { brand: ShareBrand }) {
  if (!brand.phone && !brand.email) return null;
  return (
    <section className="relative mt-14 overflow-hidden rounded-3xl text-white shadow-sm" style={{ backgroundColor: brand.accent }}>
      <div className="absolute inset-0 bg-linear-to-br from-white/10 via-transparent to-black/40" aria-hidden="true" />
      <div className="relative p-6 sm:p-8">
        <h2 className="text-lg font-bold">Need anything during your trip?</h2>
        <p className="mt-1 text-sm text-white/80">Your team at {brand.companyName ?? 'our office'} is a call away.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {brand.phone && (
            <a
              href={telHref(brand.phone)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-white/90"
              style={{ color: brand.accent }}
            >
              <Icon name="phone" />
              {brand.phone}
            </a>
          )}
          {brand.email && (
            <a
              href={`mailto:${brand.email}`}
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold ring-1 ring-white/30 transition hover:bg-white/25"
            >
              <Icon name="mail" />
              {brand.email}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
