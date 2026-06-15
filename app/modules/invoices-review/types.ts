import type {
  BrandProfileOption,
  CustomerOption,
  OrganizationBranding,
  ProductOption,
} from '../quotes/types';

export type { BrandProfileOption, CustomerOption, OrganizationBranding, ProductOption };

export type InvoiceStatus = 'Draft' | 'Sent' | 'Partial' | 'Paid' | 'Void';
export type StatusFilter = 'All' | 'Draft' | 'Sent' | 'Overdue' | 'Partial' | 'Paid' | 'Void';
export type DiscountType = 'none' | 'percentage' | 'fixed';

export const PAYMENT_METHODS = [
  'Bank transfer',
  'Mobile money',
  'Cash',
  'Card',
  'Cheque',
  'Other',
];

export interface InvoiceItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
  total: number;
  productId: number | null;
}

export interface InvoicePaymentSummary {
  id: number;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  paidAt: string;
  recordedBy: { id: number; name: string } | null;
  createdAt: string;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  brandProfile: { id: number; name: string; companyName: string | null; primaryColor: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  itemCount: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceItemSummary[];
  payments: InvoicePaymentSummary[];
}

export interface InvoiceableQuote {
  id: number;
  reference: string;
  subject: string;
  customer: string;
  total: number;
  currency: string;
}
