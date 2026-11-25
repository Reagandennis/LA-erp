'use client';

import { useState } from 'react';

import { ChevronDownIcon } from '@/app/ui/icons';

export interface ActionItem {
  tool: string;
  result: unknown;
  args?: Record<string, unknown>;
  /** Decided by the server from the tool's result. Absent on chats saved before it was sent. */
  ok?: boolean;
  kind?: 'read' | 'write';
  /** One line a person can read: "Added Airport pickup to BRG-ZAF-NOV-2668". */
  summary?: string;
  /** Where the record lives in the app. */
  href?: string;
}

/** What a reply did, counted by the server from the tools' own results. */
export interface Outcome {
  changed: number;
  failed: number;
}

export interface ToolCallView {
  index: number;
  name: string;
  target: string | null;
  ok: boolean;
  detail: string | null;
  href: string | null;
}

/** Tool names keep the `customer` identifier; users see the business term "client". */
const readable = (tool: string) => tool.replace(/_/g, ' ').replace(/\bcustomer(s?)\b/g, 'client$1');

const errorOf = (action: ActionItem) => {
  const error = (action.result as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : null;
};

const failed = (action: ActionItem) => action.ok === false || errorOf(action) !== null;

/** Only links into this app are shown; anything else a result carries stays text. */
const safeHref = (href: string | undefined) => (href && href.startsWith('/') && !href.startsWith('//') ? href : null);

/** Derives a readable name/target/status from a raw tool result. */
export function describeAction(action: ActionItem, index: number): ToolCallView {
  const result = (action.result ?? {}) as Record<string, unknown>;
  const identifier = result.reference ?? result.number ?? result.id;
  const list = Array.isArray(result) ? result : Object.values(result).find(Array.isArray);
  const count = Array.isArray(list) ? list.length : null;

  let target: string | null = null;
  if (action.summary) {
    target = action.summary;
  } else if (identifier != null && typeof identifier !== 'object') {
    target = String(identifier);
  } else if (count != null) {
    target = `${count} result${count === 1 ? '' : 's'}`;
  }

  return {
    index,
    name: readable(action.tool),
    target,
    ok: !failed(action),
    detail: errorOf(action),
    href: safeHref(action.href),
  };
}

/**
 * What the reply actually did, under every answer. It is drawn from the
 * server's count of the tools' results, not from the reply's wording, so a
 * reply that says "done" over nothing reads "No changes made".
 */
export function OutcomeLine({
  outcome,
  actions,
  waiting = false,
}: Readonly<{
  outcome: Outcome;
  actions: ActionItem[];
  /** The reply is holding an action for the user's Confirm. */
  waiting?: boolean;
}>) {
  const changes = actions.filter((action) => action.kind === 'write' && !failed(action));
  const failures = actions.filter(failed);

  return (
    <div className="mt-2 space-y-1.5">
      {failures.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
          <p className="text-xs font-bold text-rose-700">
            {failures.length === 1 ? '1 step failed and was not done' : `${failures.length} steps failed and were not done`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {failures.map((action, index) => (
              <li key={index} className="text-xs leading-relaxed text-rose-700">
                <span className="font-bold">{readable(action.tool)}:</span> {errorOf(action) ?? 'failed'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {changes.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
          <p className="text-xs font-bold text-emerald-800">
            {changes.length === 1 ? '1 change made' : `${changes.length} changes made`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {changes.map((action, index) => {
              const view = describeAction(action, index);
              return (
                <li key={index} className="flex items-baseline gap-2 text-xs leading-relaxed text-emerald-900">
                  <span className="min-w-0 break-words">{action.summary ?? `${view.name}${view.target ? ` · ${view.target}` : ''}`}</span>
                  {view.href && (
                    <a
                      href={view.href}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                    >
                      Open
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] font-bold text-gray-400">
          {waiting
            ? 'Nothing has changed yet. Waiting for you to confirm.'
            : outcome.failed > 0
              ? 'Nothing was changed.'
              : 'No changes made.'}
        </p>
      )}
    </div>
  );
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
          {actions.length} step{actions.length === 1 ? '' : 's'}
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
                {view.target && !view.detail && (
                  <span className="truncate text-[11px] text-gray-400">
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
