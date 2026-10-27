'use client';

import { useState } from 'react';

import type { OpsTasks } from '@/lib/ops-dashboard';

import { Check, Empty, HeaderButton, Panel, type PanelFrame, Pill, fieldClass, relativeDays, send } from './ops-ui';

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-400',
  low: 'bg-gray-300',
};

/** The viewer's open tasks (and ones shared with them): add one, tick one off. */
export default function TasksPanel({
  data,
  frame,
  onChanged,
}: Readonly<{ data: OpsTasks; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');

  const complete = async (id: number) => {
    setBusy(id);
    try {
      if (await send(`/api/planning/tasks/${id}`, 'PUT', { completed: true })) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!title.trim()) return;
    setBusy('new');
    try {
      // The date input's "YYYY-MM-DD", as the Tasks module sends it.
      if (await send('/api/planning/tasks', 'POST', { title: title.trim(), dueDate: dueDate || null, priority })) {
        setTitle('');
        setDueDate('');
        setPriority('medium');
        await onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="ops-tasks"
      icon="todo-personal"
      title="Tasks"
      count={data.open}
      tone={data.overdue > 0 ? 'danger' : 'neutral'}
      href="/modules/todo-personal"
      moduleName="Tasks"
      frame={frame}
      actions={
        <HeaderButton active={adding} onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : '+ Task'}
        </HeaderButton>
      }
    >
      {adding && (
        <form
          className="mb-2 space-y-2 rounded-xl bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            placeholder="What needs doing?"
            aria-label="Task title"
            className={fieldClass}
          />
          <div className="flex gap-2">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" className={fieldClass} />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority" className={`${fieldClass} w-28 shrink-0`}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button
              type="submit"
              disabled={busy === 'new' || !title.trim()}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      )}

      {data.overdue > 0 && (
        <p className="px-3 pb-1 pt-1 text-xs font-semibold text-rose-600">
          {data.overdue} overdue
        </p>
      )}

      {data.tasks.length === 0 ? (
        <Empty>No open tasks.</Empty>
      ) : (
        <ul className="space-y-0.5">
          {data.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-gray-50">
              <Check
                checked={false}
                disabled={task.shared || busy === task.id}
                label={task.shared ? 'Only its owner can complete a shared task' : 'Mark done'}
                onChange={() => void complete(task.id)}
              />
              <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.low}`} title={`${task.priority} priority`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">{task.title}</span>
                <span className="block truncate text-[11px] text-gray-400">
                  {task.status}
                  {task.shared && ' · shared with you'}
                </span>
              </span>
              {task.days !== null && (
                <Pill tone={task.days < 0 ? 'danger' : task.days <= 1 ? 'warn' : 'neutral'}>{relativeDays(task.days)}</Pill>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
