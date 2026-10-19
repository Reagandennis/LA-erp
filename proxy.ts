import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session-token';

const protectedPrefixes = ['/dashboard', '/admin', '/modules'];

export default function proxy(request: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
