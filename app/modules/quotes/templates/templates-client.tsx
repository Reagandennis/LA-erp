'use client';

import { useState } from 'react';

import type { TemplateOption } from '../types';

interface TemplatesClientProps {
  initialTemplates: TemplateOption[];
}

export default function TemplatesClient({ initialTemplates }: TemplatesClientProps) {
  const [templates, setTemplates] = useState<TemplateOption[]>(initialTemplates);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (template: TemplateOption) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    try {
      const response = await fetch(`/api/quotes/templates/${template.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete');
        return;
      }
      setTemplates((current) => current.filter((t) => t.id !== template.id));
    } catch {
      setError('Network error');
    }
  };

  if (templates.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-10 text-center border-2 border-dashed border-gray-200">
        <h3 className="text-lg font-black text-gray-900">No templates yet</h3>
        <p className="text-gray-500 mt-2 text-sm">
          Open a quote in the builder, fill it in, then click &quot;Save current setup as a template.&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        {templates.map((template) => (
          <div
            key={template.id}
            className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-gray-900">{template.name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {template.items.length} line items • {template.currency} • tax{' '}
                {(template.taxRate * 100).toFixed(2)}%
                {template.discountType !== 'none'
                  ? ` • discount ${template.discountType}`
                  : ''}
              </p>
              {template.description && (
                <p className="text-xs text-gray-500 mt-1">{template.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleDelete(template)}
              className="px-3 py-1.5 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 self-start sm:self-auto"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
