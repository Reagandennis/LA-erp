export type QuoteStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'Declined'
  | 'Sent'
  | 'Expired';

export type StatusFilter = 'All' | QuoteStatus;

export type DiscountType = 'none' | 'percentage' | 'fixed';

export interface CustomerOption {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  billingAddress: string | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApproverOption {
  id: number;
  name: string;
  email: string;
}

export interface ProductOption {
  id: number;
  name: string;
  /** Left out where only the line-item pickers need the catalog. */
  description?: string | null;
  /** The Service Code. */
  sku: string | null;
  defaultUnitPrice: number;
  currency: string;
  taxable: boolean;
  archived: boolean;
  unitOfMeasure?: string | null;
  country?: string | null;
}

export interface TemplateOption {
  id: number;
  name: string;
  description: string | null;
  taxRate: number;
  currency: string;
  terms: string | null;
  notes: string | null;
  discountType: DiscountType;
  discountValue: number;
  items: Array<{
    description: string;
    quantity: number;
    days: number;
    unitPrice: number;
    taxable: boolean;
    discountType: DiscountType;
    discountValue: number;
    productId: number | null;
  }>;
}

export interface BrandProfileOption {
  id: number;
  name: string;
  companyName: string | null;
  primaryColor: string;
  isDefault: boolean;
  hasLogo: boolean;
}

export interface OrganizationBranding {
  companyName: string | null;
  defaultCurrency: string;
  defaultTaxRate: number;
  taxLabel: string;
  hasLogo: boolean;
}

export interface QuoteTripSummary {
  id: number;
  reference: string;
  trackingCode: string;
  status: string;
}

export interface QuoteSummary {
  id: number;
  reference: string;
  trackingCode: string | null;
  subject: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  terms: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  approver: { id: number; name: string; email: string } | null;
  brandProfile: { id: number; name: string; companyName: string | null; primaryColor: string } | null;
  itemCount: number;
  trip: QuoteTripSummary | null;
}

export interface QuoteItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  days: number;
  unitPrice: number;
  taxable: boolean;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
  productId: number | null;
}

export interface QuoteDetail extends QuoteSummary {
  items: QuoteItemSummary[];
}
