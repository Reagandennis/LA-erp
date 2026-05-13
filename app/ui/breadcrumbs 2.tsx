import Link from 'next/link';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: Readonly<BreadcrumbsProps>) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <div key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 ? <span className="text-gray-300">/</span> : null}
            {item.href && !isLast ? (
              <Link href={item.href} className="font-medium text-gray-500 transition hover:text-gray-900">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'font-semibold text-gray-900' : 'font-medium text-gray-500'}>
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
