export type QuoteStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'Declined'
  | 'Sent'
  | 'Expired';

export type StatusFilter = 'All' | QuoteStatus;

export interface CustomerOption {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApproverOption {
  id: number;
  name: string;
  email: string;
}

export interface QuoteSummary {
  id: number;
  reference: string;
  subject: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  taxRate: number;
  subtotal: number;
  total: number;
  notes: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  approver: { id: number; name: string; email: string } | null;
  itemCount: number;
}

export interface QuoteItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface QuoteDetail extends QuoteSummary {
  items: QuoteItemSummary[];
}
