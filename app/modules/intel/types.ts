// Shared types for the Intel module (mirror lib/intel.ts).

export const RISK_LEVELS = ['Low', 'Moderate', 'High', 'Extreme'] as const;

export type AssessmentSection = { heading: string; body: string };
export type AssessmentSource = { title: string; url: string };

export type AssessmentSummary = {
  id: number;
  location: string;
  formattedAddress: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  title: string;
  riskLevel: string;
  status: string;
  hasMap: boolean;
  hasStreet: boolean;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
};

export type AssessmentDetail = AssessmentSummary & {
  context: string | null;
  summary: string;
  sections: AssessmentSection[];
  recommendations: string[];
  sources: AssessmentSource[];
  model: string | null;
};

export type IntelStats = {
  total: number;
  high: number;
  recent: number;
};

export type IntelData = {
  assessments: AssessmentSummary[];
  stats: IntelStats;
};
