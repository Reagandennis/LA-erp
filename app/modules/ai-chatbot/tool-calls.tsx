'use client';

import { useState } from 'react';

import { ChevronDownIcon } from '@/app/ui/icons';

export interface ActionItem {
  tool: string;
  result: unknown;
}

export interface ToolCallView {
  index: number;
  name: string;
  target: string | null;
  ok: boolean;
  detail: string | null;
}

/** Derives a readable name/target/status from a raw tool result. */
export function describeAction(action: ActionItem, index: number): ToolCallView {
  const result = (action.result ?? {}) as Record<string, unknown>;
  const name = action.tool.replace(/_/g, ' ');
  const failed = typeof result.error === 'string';

  const identifier = result.reference ?? result.number ?? result.id;
  const count = Array.isArray(result.items)
    ? result.items.length
    : Array.isArray(result)
      ? (result as unknown[]).length
      : null;

  let target: string | null = null;
  if (identifier != null) {
    target = String(identifier);
  } else if (count != null) {
    target = `${count} result${count === 1 ? '' : 's'}`;
  }

  return {
    index,
    name,
    target,
    ok: !failed,
    detail: failed ? (result.error as string) : null,
  };
}

export default function ToolCalls({
  actions,
  defaultExpanded = false,
  onInspect,
}: Readonly<{
  actions: ActionItem[];
  defaultExpanded?: boolean;
  onInspect: (action: ActionItem, label: string) => void;
}>) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (actions.length === 0) {
    return null;
  }

  const views = actions.map(describeAction);
  const failures = views.filter((view) => !view.ok).length;

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50"
      >
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${
            expanded ? '' : '-rotate-90'
          }`}
        />
        <span className="text-xs font-bold text-gray-600">
          {actions.length} tool call{actions.length === 1 ? '' : 's'}
        </span>
        {failures > 0 && (
          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
            {failures} failed
          </span>
        )}
      </button>

      {expanded && (
        <ul className="border-t border-gray-100">
          {views.map((view) => (
            <li key={view.index} className="border-b border-gray-50 last:border-b-0">
              <button
                type="button"
                onClick={() => onInspect(actions[view.index], view.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    view.ok ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="shrink-0 font-mono text-[11px] font-bold text-primary">
                  {view.name}
                </span>
                {view.target && (
                  <span className="truncate font-mono text-[11px] text-gray-400">
                    {view.target}
                  </span>
                )}
                {view.detail && (
                  <span className="truncate text-[11px] text-rose-500">{view.detail}</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] font-bold text-gray-300">
                  View
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
