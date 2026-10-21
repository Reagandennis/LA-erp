/**
 * Pages for people outside the company (a client's trip link), shown without
 * the app's sidebar, clocks and alerts. The proxy marks them with this header
 * for the root layout, and strips it from every other request so it can't be
 * sent in from outside.
 */
export const PUBLIC_PAGE_HEADER = 'x-la-public-page';

export function isPublicPage(pathname: string): boolean {
  return pathname.startsWith('/share/');
}
