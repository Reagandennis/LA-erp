import { NextRequest, NextResponse } from 'next/server';

import { PUBLIC_PAGE_HEADER, isPublicPage } from '@/lib/public-pages';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session-token';

const protectedPrefixes = ['/dashboard', '/admin', '/modules'];

/**
 * Work-device passkeys only work on the one address in WEBAUTHN_ORIGIN, so
 * pages opened on any other public name (e.g. the old erp.ladyaskari.app) are
 * sent there. API routes are not matched by this proxy, so OAuth callbacks and
 * webhooks on the old name keep working. Local probes (localhost, bare IPs) are
 * left alone.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const configured = process.env.WEBAUTHN_ORIGIN?.trim();
  if (!configured) return null;
  let canonical: URL;
  try {
    canonical = new URL(configured);
  } catch {
    return null;
  }
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  if (!hostname || hostname === canonical.hostname) return null;
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.startsWith('[')) return null;
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical.origin);
  return NextResponse.redirect(target, 308);
}

export default function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;

  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (isProtected && !session) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Signed-in users are sent from the auth pages to /dashboard by those pages
  // (getServerAuth), not here. A JWT can outlive its Session row (revoked,
  // pruned, DB restored), and redirecting on the JWT alone would bounce
  // /dashboard -> /auth/login -> /dashboard forever.

  // Tell the root layout whether this is a page for outsiders (lib/public-pages).
  const requestHeaders = new Headers(request.headers);
  if (isPublicPage(pathname)) requestHeaders.set(PUBLIC_PAGE_HEADER, '1');
  else requestHeaders.delete(PUBLIC_PAGE_HEADER);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
