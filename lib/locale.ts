/**
 * Locale for every user-facing date, time and number.
 *
 * Pinned on purpose: `toLocaleString()` without a locale formats with the
 * *process* locale, so server-rendered HTML (Node's locale) differed from the
 * browser's, and React then threw the server render away and re-rendered the
 * whole page on the client (hydration error #418). One constant keeps both
 * sides identical and makes PDFs and emails deterministic across machines.
 *
 * Change it here if the business prefers another convention (e.g. 'en-GB'
 * for day/month/year). Times also depend on the server's TZ; see .env.example.
 */
export const APP_LOCALE = 'en-US';
