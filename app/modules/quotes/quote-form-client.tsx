'use client';

import { useRouter } from 'next/navigation';

import QuoteBuilder from './quote-builder';
import type {
  ApproverOption,
  BrandProfileOption,
  CustomerOption,
  OrganizationBranding,
  ProductOption,
  QuoteDetail,
  TemplateOption,
} from './types';

interface QuoteFormClientProps {
  mode: 'create' | 'edit';
  quote: QuoteDetail | null;
  customers: CustomerOption[];
  approvers: ApproverOption[];
  products: ProductOption[];
  templates: TemplateOption[];
  brandProfiles: BrandProfileOption[];
  organization: OrganizationBranding;
}

export default function QuoteFormClient(props: QuoteFormClientProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <QuoteBuilder
        mode={props.mode}
        quote={props.quote}
        customers={props.customers}
        approvers={props.approvers}
        products={props.products}
        templates={props.templates}
        brandProfiles={props.brandProfiles}
        organization={props.organization}
        onClose={() => router.push('/modules/quotes')}
        onCustomerCreated={() => router.refresh()}
        onTemplateCreated={() => router.refresh()}
        onSaved={(quote) => {
          router.push(`/modules/quotes?selected=${quote.id}`);
          router.refresh();
        }}
      />
    </div>
  );
}
