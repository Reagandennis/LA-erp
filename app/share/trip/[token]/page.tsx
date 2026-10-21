import type { Metadata } from 'next';
import { cache } from 'react';

import { dateKey } from '@/lib/date-grid';
import { resolveDocumentBrand } from '@/lib/document-pdf';
import { openSharedTrip } from '@/lib/trip-share';

import { ItineraryView } from './itinerary-view';

export const dynamic = 'force-dynamic';

/** One load per request, shared by the title and the page, so a visit counts once. */
const loadSharedTrip = cache((token: string) => openSharedTrip(token, { recordView: true }));

/** Brand colours are typed in by admins; only a hex colour reaches the style attribute. */
function safeColor(value: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#03458f';
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const shared = await loadSharedTrip((await params).token);
  return {
    title: shared?.state === 'open' ? `${shared.itinerary.title} · Itinerary` : 'Trip itinerary',
    // The URL is the credential: keep it out of search engines and other sites' logs.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await loadSharedTrip(token);

  if (!shared) {
    return (
      <Notice
        title="This link isn't available"
        body="It may have been replaced with a new one or switched off. Ask whoever sent it for the latest link."
      />
    );
  }
  if (shared.state === 'ended') {
    return (
      <Notice
        title={`${shared.title} has ended`}
        body="This link only works while the trip is under way. The PDF you were sent is yours to keep."
      />
    );
  }

  const { brand, logo } = await resolveDocumentBrand(shared.brandProfileId);
  const now = new Date();
  return (
    <ItineraryView
      itinerary={shared.itinerary}
      token={token}
      now={now}
      todayKey={dateKey(now)}
      brand={{
        companyName: brand.companyName,
        phone: brand.phone,
        email: brand.email,
        accent: safeColor(brand.primaryColor),
        logoSrc: logo ? `data:${logo.mimeType};base64,${logo.buffer.toString('base64')}` : null,
      }}
    />
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#f5f6f8] px-4">
      <div className="max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-bold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">{body}</p>
      </div>
    </main>
  );
}
