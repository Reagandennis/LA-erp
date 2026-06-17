// Shared types for the Handover module (mirror lib/handover.ts).

export const SHIFT_PERIODS = ['Day', 'Night', 'Morning', 'Afternoon', 'Evening'] as const;
export const HANDOVER_STATUSES = ['Normal', 'Attention', 'Urgent'] as const;

export type HandoverSummary = {
  id: number;
  shiftDate: string;
  shiftPeriod: string;
  post: string | null;
  status: string;
  summary: string;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  acknowledgedBy: { id: number; name: string } | null;
  acknowledgedAt: string | null;
};

export type HandoverDetail = HandoverSummary & {
  incidents: string | null;
  watchItems: string | null;
};

export type HandoverStats = {
  awaiting: number;
  attention: number;
  thisWeek: number;
  total: number;
};

export type HandoverData = {
  handovers: HandoverDetail[];
  stats: HandoverStats;
};

export type StatusFilter = 'All' | 'Awaiting' | (typeof HANDOVER_STATUSES)[number];
