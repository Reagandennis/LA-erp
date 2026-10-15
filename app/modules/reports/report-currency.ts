/**
 * Currencies the reports page can be shown in, chosen with `?currency=`. The
 * first is the default: the business reports in Kenyan shillings, while most
 * invoices and quotes are issued in US dollars and converted for display.
 */
export const REPORT_CURRENCIES = ['KES', 'USD'] as const;

export type ReportCurrency = (typeof REPORT_CURRENCIES)[number];

export function parseReportCurrency(value: string | string[] | undefined): ReportCurrency {
  const code = (Array.isArray(value) ? value[0] : value)?.toUpperCase();
  return REPORT_CURRENCIES.find((c) => c === code) ?? REPORT_CURRENCIES[0];
}
