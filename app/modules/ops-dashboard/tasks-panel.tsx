'use client';

import { useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import { APP_LOCALE } from '@/lib/locale';
import type { OpsTasks } from '@/lib/ops-dashboard';

import { Check, Empty, HeaderButton, Panel, type PanelFrame, Pill, type Tone, fieldClass, formClass, primaryButton, rowClass, send, subClass } from './ops-ui';

/** Priorities worth a pill; a low one says nothing. */
const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  high: { label: 'High', tone: 'danger' },
  medium: { label: 'Medium', tone: 'warn' },
};

/** When a task is due: days overdue, Today, Tomorrow, the weekday inside a week, then the days ahead. */
function due(days: number, now: number | null): { label: string; tone: Tone } {
  if (days < 0) return { label: `${-days}d overdue`, tone: 'danger' };
  if (days === 0) return { label: 'Today', tone: 'warn' };
  if (days === 1) return { label: 'Tomorrow', tone: 'warn' };
  if (now !== null && days <= 6) {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return { label: date.toLocaleDateString(APP_LOCALE, { weekday: 'short' }), tone: 'info' };
  }
  return { label: `In ${days}d`, tone: 'info' };
}

/** The viewer's open tasks (and ones shared with them): add one, tick one off. */
export default function TasksPanel({
  data,
  frame,
  onChanged,
}: Readonly<{ data: OpsTasks; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(60_000);
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
      title="Tasks"
      summary={
        <>
          {data.open} open
          {data.overdue > 0 && (
            <>
              {' · '}
              <span className="text-rose-600">{data.overdue} overdue</span>
            </>
          )}
        </>
      }
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
          className={`${formClass} space-y-2`}
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
            <button type="submit" disabled={busy === 'new' || !title.trim()} className={`${primaryButton} shrink-0`}>
              Add
            </button>
          </div>
        </form>
      )}

      {data.tasks.length === 0 ? (
        <Empty>No open tasks.</Empty>
      ) : (
        <ul>
          {data.tasks.map((task) => {
            const when = task.days === null ? null : due(task.days, now);
            const level = PRIORITY[task.priority];
            return (
              <li key={task.id} className={rowClass}>
                <Check
                  checked={false}
                  disabled={task.shared || busy === task.id}
                  label={task.shared ? 'Only its owner can complete a shared task' : 'Mark done'}
                  onChange={() => void complete(task.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{task.title}</span>
                  <span className={subClass}>
                    {task.status}
                    {task.shared && ' · shared with you'}
                  </span>
                </span>
                {when && <Pill tone={when.tone}>{when.label}</Pill>}
                {level && <Pill tone={level.tone}>{level.label}</Pill>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
