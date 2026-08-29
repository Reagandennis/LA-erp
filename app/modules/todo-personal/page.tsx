'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import CalendarClient, { type CalendarExtraEvent } from '@/app/modules/calendar/calendar-client';
import { useBanner } from '@/app/ui/banner';
import { dateKeyFromIso, dayFromIso, isoFromDateKey } from '@/lib/date-grid';
import GanttChart from './gantt-chart';
import KanbanBoard from './kanban-board';


const DEFAULT_KANBAN_COLUMNS = ['Backlog', 'In progress', 'In review'];
const DEFAULT_COLUMN_COLORS: Record<string, string> = {
  Backlog: '#E5E7EB',
  'In progress': '#FDBA74',
  'In review': '#86EFAC',
};

type MentionUser = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

const USER_COLORS = ['bg-blue-500', 'bg-purple-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500'];

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size)) {
    return '0 B';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const kb = size / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
};

type ViewType = 'list' | 'kanban' | 'gantt' | 'calendar' | 'dashboard';

type Task = {
  id: string;
  dbId?: number | null;
  title: string;
  description?: string | null;
  priority: 'High' | 'Medium' | 'Low';
  list: string;
  dueDate: string | null;
  dueDateIso?: string | null;
  startDateIso?: string | null;
  status: string;
  assignees: number;
  completed?: boolean;
  deletedAt?: string | null;
};

type TaskScope = 'Active' | 'Completed' | 'Deleted';
const TASK_SCOPES: TaskScope[] = ['Active', 'Completed', 'Deleted'];

function taskMatchesScope(task: Task, scope: TaskScope): boolean {
  if (task.deletedAt) return scope === 'Deleted';
  if (scope === 'Deleted') return false;
  if (scope === 'Completed') return Boolean(task.completed);
  return !task.completed; // Active
}

type Subtask = {
  id: string;
  title: string;
  completed: boolean;
};

type CommentItem = {
  id: string;
  author: string;
  time: string;
  text: string;
};

type AttachmentItem = {
  id: number;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
};

type NotificationItem = {
  id: number;
  todoId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type ApiComment = {
  id: number;
  text: string;
  author: string;
  createdAt: string;
};

type ApiTask = {
  id: number;
  isShared?: boolean;
  title: string;
  description: string | null;
  priority: string;
  status?: string;
  startDate?: string | null;
  dueDate: string | null;
  completed: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The fields a re-render would actually be able to show. */
const taskFingerprint = (task: Task) =>
  [
    task.id,
    task.title,
    task.status,
    task.priority,
    task.startDateIso ?? '',
    task.dueDateIso ?? '',
    task.completed ? '1' : '0',
    task.deletedAt ?? '',
  ].join('\u0000');

const fetchTasks = async (signal?: AbortSignal): Promise<Task[]> => {
  try {
    const response = await fetch('/api/planning/tasks', {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json().catch(() => null)) as { tasks?: ApiTask[] } | null;
    const apiTasks = data?.tasks ?? [];
    return apiTasks.map((task) => {
      const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null;
      const status = task.status ?? (task.completed ? 'In review' : 'Backlog');
      const priority = task.priority
        ? (task.priority[0].toUpperCase() + task.priority.slice(1))
        : 'Medium';
      return {
        id: `PT-${task.id}`,
        dbId: task.id,
        title: task.title,
        description: task.description,
        priority: priority as Task['priority'],
        list: task.isShared ? 'Shared' : 'Personal',
        dueDate,
        dueDateIso: task.dueDate,
        startDateIso: task.startDate ?? null,
        status,
        assignees: 0,
        completed: task.completed,
        deletedAt: task.deletedAt ?? null,
      };
    });
  } catch {
    return [];
  }
};

function DashStat({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function DashCard({
  title,
  subtitle,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-5 ${className}`}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {subtitle ? <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function CompletionDonut({ percent, doneCount, total }: { percent: number; doneCount: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="150" height="150" viewBox="0 0 120 120" className="shrink-0">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#eef2f7" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#03458f"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="58" textAnchor="middle" className="fill-gray-900" style={{ fontSize: 24, fontWeight: 700 }}>
          {percent}%
        </text>
        <text x="60" y="78" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 11 }}>
          done
        </text>
      </svg>
      <p className="mt-3 text-sm text-gray-500">
        {doneCount} of {total} tasks
      </p>
    </div>
  );
}

function StackedBar({
  segments,
  total,
}: {
  segments: { label: string; count: number; color: string }[];
  total: number;
}) {
  return (
    <div>
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-100">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.label}
              style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.count}`}
            />
          ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="truncate text-gray-600">{s.label}</span>
            <span className="ml-auto font-semibold text-gray-900">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; count: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-gray-600">{row.label}</span>
            <span className="text-gray-400">{row.count}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${(row.count / max) * 100}%`, backgroundColor: row.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TodoPersonalPage() {
  const [activeView, setActiveView] = useState<ViewType>('kanban');
  const [scope, setScope] = useState<TaskScope>('Active');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, Subtask[]>>({});
  const [commentsByTask, setCommentsByTask] = useState<Record<string, CommentItem[]>>({});
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [attachmentsByTask, setAttachmentsByTask] = useState<Record<string, AttachmentItem[]>>({});
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [commentInput, setCommentInput] = useState<string>('');
  const [subtaskTitle, setSubtaskTitle] = useState<string>('');
  const loadComments = async (task: Task) => {
    if (!task.dbId) {
      setComments([]);
      setCommentsByTask((current) => ({
        ...current,
        [task.id]: [],
      }));
      return;
    }

    try {
      const response = await fetch(`/api/planning/tasks/${task.dbId}/comments`, {
        credentials: 'include',
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json().catch(() => null)) as { comments?: ApiComment[] } | null;
      const mapped = (data?.comments ?? []).map((comment) => ({
        id: String(comment.id),
        author: comment.author,
        time: new Date(comment.createdAt).toLocaleString(),
        text: comment.text,
      }));
      setComments(mapped);
      setCommentsByTask((current) => ({
        ...current,
        [task.id]: mapped,
      }));
    } catch {
      // ignore
    }
  };
  const toggleLegacySubtask = (subtaskId: string) => {
    updateSubtasks(
      subtasks.map((subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              completed: !subtask.completed,
            }
          : subtask,
      ),
    );
  };
  const removeLegacySubtask = (subtaskId: string) => {
    updateSubtasks(subtasks.filter((subtask) => subtask.id !== subtaskId));
  };
  const updateSubtasks = (next: Subtask[]) => {
    setSubtasks(next);
    if (selectedTask) {
      setSubtasksByTask((current) => ({
        ...current,
        [selectedTask.id]: next,
      }));
    }
  };
  const openTaskDrawer = (task: Task) => {
    setSelectedTask(task);
    setEditedTask({ ...task });
    setDescription(task.description ?? '');
    setSubtaskTitle('');
    setTaggedUsers([]);
    setDueTime(task.dueDateIso ? new Date(task.dueDateIso).toTimeString().slice(0, 5) : '');
    // Load subtasks from DB; fall back to in-memory cache
    if (task.dbId) {
      fetch(`/api/planning/tasks/${task.dbId}/subtasks`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { subtasks?: Subtask[] } | null) => {
          const rawLoaded = data?.subtasks;
          const loaded: Subtask[] = Array.isArray(rawLoaded) ? rawLoaded : (subtasksByTask[task.id] ?? []);
          setSubtasks(loaded);
          setSubtasksByTask((cur) => ({ ...cur, [task.id]: loaded }));
        })
        .catch(() => {
          updateSubtasks(subtasksByTask[task.id] ?? []);
        });
    } else {
      updateSubtasks(subtasksByTask[task.id] ?? []);
    }
    if (commentsByTask[task.id]) {
      setComments(commentsByTask[task.id] ?? []);
    } else {
      void loadComments(task);
    }
    setAttachments(attachmentsByTask[task.id] ?? []);
    setCommentInput('');
  };
  const handleSendComment = async () => {
    if (!selectedTask || !commentInput.trim()) {
      return;
    }
    if (!selectedTask.dbId) {
      return;
    }
    const mentionedUserIds = availableUsers
      .filter((user) => commentInput.toLowerCase().includes(`@${user.name.toLowerCase()}`))
      .map((user) => Number(user.id))
      .filter((value) => Number.isInteger(value) && value > 0);
    try {
      const response = await fetch(`/api/planning/tasks/${selectedTask.dbId}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: commentInput.trim(),
          userIds: Array.from(new Set(mentionedUserIds)),
        }),
      });
      if (!response.ok) {
        return;
      }
      setCommentInput('');
      await loadComments(selectedTask);
      await fetch('/api/planning/notifications', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.notifications) {
            setNotifications(data.notifications as NotificationItem[]);
          }
        })
        .catch(() => {
          // ignore
        });
    } catch {
      // ignore
    }
  };
  const loadAttachmentsForTask = async (task: Task) => {
    if (!task.dbId) {
      return;
    }
    try {
      const response = await fetch(`/api/planning/tasks/${task.dbId}/attachments`, {
        credentials: 'include',
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json().catch(() => null)) as { attachments?: AttachmentItem[] } | null;
      const nextAttachments = data?.attachments ?? [];
      setAttachments(nextAttachments);
      setAttachmentsByTask((current) => ({
        ...current,
        [task.id]: nextAttachments,
      }));
    } catch {
      // ignore
    }
  };
  const handleAddSubtask = () => {
    if (!subtaskTitle.trim()) {
      return;
    }
    const nextSubtask: Subtask = {
      id: `${selectedTask?.id ?? 'task'}-st-${createIdRef.current++}`,
      title: subtaskTitle.trim(),
      completed: false,
    };
    updateSubtasks([nextSubtask, ...subtasks]);
    setSubtaskTitle('');
  };
  const handleAddAttachments = async (files: FileList | null) => {
    if (!selectedTask?.dbId || !files || files.length === 0) {
      return;
    }
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    try {
      await fetch(`/api/planning/tasks/${selectedTask.dbId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      await loadAttachmentsForTask(selectedTask);
    } catch {
      // ignore
    }
  };
  const toggleTaggedUser = (userId: string) => {
    setTaggedUsers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };
  const toggleCreateTaggedUser = (userId: string) => {
    setCreateTaggedUsers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };
  const shareTaskWithUsers = async (taskId: number, userIds: string[]) => {
    const normalized = Array.from(
      new Set(
        userIds
          .map(Number)
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    if (normalized.length === 0) {
      return;
    }
    try {
      await fetch(`/api/planning/tasks/${taskId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: normalized }),
      });
    } catch {
      // ignore
    }
  };
  const handleNotesChange = (value: string) => {
    setCommentInput(value);
    const mentionMatch = /@([\w-]*)$/.exec(value);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };
  const handleCreateNotesChange = (value: string) => {
    setCreateNotes(value);
    const mentionMatch = /@([\w-]*)$/.exec(value);
    if (mentionMatch) {
      setCreateMentionQuery(mentionMatch[1]);
      setShowCreateMentions(true);
    } else {
      setShowCreateMentions(false);
    }
  };
  const applyMention = (name: string) => {
    setCommentInput((current) => current.replace(/@[\w-]*$/, `@${name} `));
    setShowMentions(false);
  };
  const applyCreateMention = (name: string) => {
    setCreateNotes((current) => current.replace(/@[\w-]*$/, `@${name} `));
    setShowCreateMentions(false);
  };
  const resetCreateDrawer = () => {
    setCreateTask({
      id: '',
      title: '',
      priority: 'Medium',
      list: '',
      dueDate: null,
      status: 'Backlog',
      assignees: 0,
    });
    setCreateSubtasks([]);
    setCreateNotes('');
    setCreateDescription('');
    setCreateDueTime('');
    setCreateAttachments([]);
    setCreateError('');
    setCreateTaggedUsers([]);
  };
  const handleCreateDrawerSave = async () => {
    if (!createTask.title.trim()) {
      return;
    }
    setCreateError('');
    let createdDbId: number | null = null;

    try {
      const response = await fetch('/api/planning/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: createTask.title,
          description: createDescription || null,
          priority: createTask.priority.toLowerCase(),
          status: createTask.status,
          dueDate: createTask.dueDate,
          completed: false,
        }),
      });

      if (!response.ok) {
        setCreateError('Unable to save task. Please sign in again.');
        return;
      }
      const data = (await response.json().catch(() => null)) as { task?: { id: number } } | null;
      createdDbId = data?.task?.id ?? null;
    } catch {
      setCreateError('Unable to save task. Please try again.');
      return;
    }

    if (!createdDbId) {
      setCreateError('Unable to save task. Please try again.');
      return;
    }

    await shareTaskWithUsers(createdDbId, createTaggedUsers);

    if (createdDbId && createAttachments.length > 0) {
      try {
        const formData = new FormData();
        createAttachments.forEach((file) => formData.append('files', file));
        await fetch(`/api/planning/tasks/${createdDbId}/attachments`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
      } catch {
        // ignore
      }
    }

    // Persist subtasks to DB
    if (createSubtasks.length > 0) {
      try {
        await fetch(`/api/planning/tasks/${createdDbId}/subtasks`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtasks: createSubtasks }),
        });
      } catch {
        // ignore
      }
    }

    // Send notes as a real comment
    if (createNotes.trim().length > 0) {
      try {
        await fetch(`/api/planning/tasks/${createdDbId}/comments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: createNotes.trim(), userIds: [] }),
        });
      } catch {
        // ignore
      }
    }

    // Use the canonical ID that fetchTasks will return (PT-{dbId})
    const canonicalId = `PT-${createdDbId}`;
    fetchTasks()
      .then((nextTasks) => {
        setTasks(nextTasks);
      })
      .catch(() => {
        // ignore
      });
    if (createSubtasks.length > 0) {
      setSubtasksByTask((current) => ({
        ...current,
        [canonicalId]: createSubtasks,
      }));
    }
    setShowCreateDrawer(false);
    resetCreateDrawer();
  };
  const addCreateSubtask = () => {
    if (!createSubtaskTitle.trim()) {
      return;
    }
    setCreateSubtasks((current) => [
      ...current,
      { id: `${createIdRef.current++}`, title: createSubtaskTitle.trim(), completed: false },
    ]);
    setCreateSubtaskTitle('');
  };
  const toggleCreateSubtask = (subtaskId: string) => {
    setCreateSubtasks((current) =>
      current.map((item) =>
        item.id === subtaskId
          ? {
              ...item,
              completed: !item.completed,
            }
          : item,
      ),
    );
  };
  const removeCreateSubtask = (subtaskId: string) => {
    setCreateSubtasks((current) => current.filter((item) => item.id !== subtaskId));
  };

  const [description, setDescription] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
  const banner = useBanner();
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [taggedUsers, setTaggedUsers] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string>('');
  const [showMentions, setShowMentions] = useState(false);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [createTask, setCreateTask] = useState<Task>({
    id: '',
    title: '',
    priority: 'Medium',
    list: '',
    dueDate: null,
    status: 'Backlog',
    assignees: 0,
  });
  const [createSubtasks, setCreateSubtasks] = useState<Array<{ id: string; title: string; completed: boolean }>>([]);
  const [createSubtaskTitle, setCreateSubtaskTitle] = useState<string>('');
  const [createNotes, setCreateNotes] = useState<string>('');
  const [createDescription, setCreateDescription] = useState<string>('');
  const [createDueTime, setCreateDueTime] = useState<string>('');
  const [createAttachments, setCreateAttachments] = useState<File[]>([]);
  const [createError, setCreateError] = useState<string>('');
  const createIdRef = useRef(1000);
  const [createTaggedUsers, setCreateTaggedUsers] = useState<string[]>([]);
  const [createMentionQuery, setCreateMentionQuery] = useState<string>('');
  const [showCreateMentions, setShowCreateMentions] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<MentionUser[]>([]);
  const [kanbanColumns, setKanbanColumns] = useState<string[]>(DEFAULT_KANBAN_COLUMNS);
  const [newColumnName, setNewColumnName] = useState<string>('');
  const [newColumnColor, setNewColumnColor] = useState<string>('#60A5FA');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [columnColors, setColumnColors] = useState<Record<string, string>>(DEFAULT_COLUMN_COLORS);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [taskOrder, setTaskOrder] = useState<string[]>([]);
  const kanbanSyncReady = useRef(false);
  useEffect(() => {
    let isActive = true;
    const loadUsers = async () => {
      try {
        const response = await fetch('/api/users/mentions', { credentials: 'include' });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { users?: Array<{ id: number; name: string | null; email: string }> }
          | null;
        const users = (data?.users ?? []).map((user, index) => {
          const name = user.name || user.email.split('@')[0] || 'Unknown';
          return {
            id: String(user.id),
            name,
            initials: getInitials(name),
            color: USER_COLORS[index % USER_COLORS.length],
          } as MentionUser;
        });
        if (isActive) {
          setAvailableUsers(users);
        }
      } catch {
        // ignore
      }
    };

    void loadUsers();

    return () => {
      isActive = false;
    };
  }, []);
  useEffect(() => {
    let isActive = true;

    const loadKanbanBoard = async () => {
      try {
        const response = await fetch('/api/planning/todo-personal/board', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | {
              board?: {
                columns?: string[];
                columnColors?: Record<string, string> | null;
                taskOrder?: string[] | null;
              } | null;
            }
          | null;
        if (!isActive) {
          return;
        }
        if (data?.board?.columns && data.board.columns.length > 0) {
          setKanbanColumns(data.board.columns);
        }
        if (data?.board?.columnColors) {
          setColumnColors(data.board.columnColors);
        }
        if (Array.isArray(data?.board?.taskOrder)) {
          setTaskOrder(data.board.taskOrder);
        }
      } catch {
        // ignore
      } finally {
        if (isActive) {
          kanbanSyncReady.current = true;
        }
      }
    };

    void loadKanbanBoard();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!kanbanSyncReady.current) {
      return;
    }

    const controller = new AbortController();

    const persistKanbanBoard = async () => {
      try {
        await fetch('/api/planning/todo-personal/board', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            columns: kanbanColumns,
            columnColors,
            taskOrder,
          }),
        });
      } catch {
        // ignore
      }
    };

    void persistKanbanBoard();

    return () => {
      controller.abort();
    };
  }, [kanbanColumns, columnColors, taskOrder]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    let isActive = true;

    const loadAttachments = async () => {
      if (!selectedTask.dbId) {
        if (isActive) {
          setAttachments([]);
          setAttachmentsByTask((current) => ({
            ...current,
            [selectedTask.id]: [],
          }));
        }
        return;
      }

      try {
        await loadAttachmentsForTask(selectedTask);
      } catch {
        // ignore
      }
    };

    void loadAttachments();
    const interval = setInterval(() => {
      void loadAttachments();
    }, 5000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [selectedTask]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const updateTaskStatus = async (task: Task, nextStatus: string) => {
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: nextStatus,
            }
          : item,
      ),
    );

    if (!task.dbId) {
      return;
    }

    try {
      await fetch(`/api/planning/tasks/${task.dbId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      // ignore
    }
  };
  const handleEditTitleChange = (value: string) => {
    setEditedTask((current) => (current ? { ...current, title: value } : current));
  };
  const handleEditPriorityChange = (value: Task['priority']) => {
    setEditedTask((current) => (current ? { ...current, priority: value } : current));
  };
  const handleEditStatusChange = (value: string) => {
    setEditedTask((current) => (current ? { ...current, status: value } : current));
  };
  const handleEditDescriptionChange = (value: string) => {
    setDescription(value);
    setEditedTask((current) => (current ? { ...current, description: value } : current));
  };
  const handleEditDueDateChange = (value: string) => {
    const isoValue = isoFromDateKey(value);
    const displayValue = dayFromIso(isoValue)?.toLocaleDateString() ?? null;
    setEditedTask((current) =>
      current
        ? {
            ...current,
            dueDateIso: isoValue,
            dueDate: displayValue,
          }
        : current,
    );
  };
  const handleEditStartDateChange = (value: string) => {
    setEditedTask((current) =>
      current ? { ...current, startDateIso: isoFromDateKey(value) } : current,
    );
  };
  const handleSaveTaskChanges = async () => {
    if (!editedTask) {
      return;
    }

    const updatedTask = {
      ...editedTask,
      description: description,
    };

    if (editedTask.dbId) {
      try {
        // Merge time into due-date ISO string
        let finalDueDate = updatedTask.dueDateIso ?? null;
        if (finalDueDate && dueTime) {
          const base = dateKeyFromIso(finalDueDate) ?? '';
          const merged = new Date(`${base}T${dueTime}:00`);
          if (!Number.isNaN(merged.getTime())) finalDueDate = merged.toISOString();
        }
        await fetch(`/api/planning/tasks/${editedTask.dbId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: updatedTask.title,
            description: updatedTask.description ?? null,
            priority: updatedTask.priority.toLowerCase(),
            status: updatedTask.status,
            startDate: updatedTask.startDateIso ?? null,
            dueDate: finalDueDate,
          }),
        });
        await shareTaskWithUsers(editedTask.dbId, taggedUsers);
        // Persist subtasks
        await fetch(`/api/planning/tasks/${editedTask.dbId}/subtasks`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtasks }),
        });
      } catch {
        // ignore
      }
    }

    fetchTasks()
      .then((nextTasks) => {
        setTasks(nextTasks);
      })
      .catch(() => {
        // ignore
      });
    setSelectedTask(null);
    setEditedTask(null);
    setSubtasks([]);
    setCommentInput('');
    setDescription('');
    setDueTime('');
  };
  const closeTaskDrawer = () => {
    setSelectedTask(null);
    setEditedTask(null);
    setSubtasks([]);
    setCommentInput('');
    setDescription('');
    setDueTime('');
  };
  const handleDeleteSelectedTask = () => {
    if (!selectedTask) return;
    const taskToDelete = selectedTask;
    // Soft delete: keep the task so it stays visible under the "Deleted" filter.
    const deletedAt = new Date().toISOString();
    setTasks((ts) => ts.map((t) => (t.id === taskToDelete.id ? { ...t, deletedAt } : t)));
    closeTaskDrawer();
    if (taskToDelete.dbId) {
      fetch(`/api/planning/tasks/${taskToDelete.dbId}`, {
        method: 'DELETE',
        credentials: 'include',
      }).catch(() => { /* ignore */ });
    }
  };
  const handleRestoreSelectedTask = () => {
    if (!selectedTask) return;
    const taskToRestore = selectedTask;
    setTasks((ts) => ts.map((t) => (t.id === taskToRestore.id ? { ...t, deletedAt: null } : t)));
    closeTaskDrawer();
    if (taskToRestore.dbId) {
      fetch(`/api/planning/tasks/${taskToRestore.dbId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted: false }),
      }).catch(() => { /* ignore */ });
    }
  };

  const DONE_COLUMN_RE = /done|complete|closed|review|shipped/i;
  const isTaskOverdue = (task: Task) => {
    if (DONE_COLUMN_RE.test(task.status)) return false;
    const due = dayFromIso(task.dueDateIso);
    if (!due) return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return due < startOfToday;
  };
  const handleTaskOpenById = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) openTaskDrawer(task);
  };

  /**
   * Ids with a write in flight. The 10s poll below replaces the whole task
   * list, so without this an optimistic drag would be reverted to the pre-drag
   * server copy for the second or two before its PUT lands.
   */
  const pendingWritesRef = useRef<Set<string>>(new Set());

  /**
   * Bumped on every optimistic edit. A poll that was already in flight when the
   * edit happened carries pre-edit data, and `pendingWritesRef` alone wouldn't
   * catch it — that request can land after the PUT has resolved and the id has
   * been cleared. Comparing the epoch across the fetch discards those replies.
   */
  const writeEpochRef = useRef(0);

  const mergeFetchedTasks = useCallback((nextTasks: Task[], epochAtFetch: number) => {
    if (epochAtFetch !== writeEpochRef.current) return;
    setTasks((current) => {
      const pending = pendingWritesRef.current;
      const merged =
        pending.size === 0
          ? nextTasks
          : (() => {
              const local = new Map(current.map((task) => [task.id, task]));
              return nextTasks.map((task) =>
                pending.has(task.id) ? local.get(task.id) ?? task : task,
              );
            })();

      // Keep the old array when nothing visible changed. Without this the poll
      // hands every view a fresh array every 10s and the whole page re-renders
      // on a timer, defeating the memoised timeline geometry.
      if (
        merged.length === current.length &&
        merged.every((task, index) => taskFingerprint(task) === taskFingerprint(current[index]))
      ) {
        return current;
      }
      return merged;
    });
  }, []);

  const handleGanttReschedule = (taskId: string, startKey: string, dueKey: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    const startIso = isoFromDateKey(startKey);
    const dueIso = isoFromDateKey(dueKey);
    if (!startIso || !dueIso) return;

    const previous = {
      startDateIso: task.startDateIso ?? null,
      dueDateIso: task.dueDateIso ?? null,
      dueDate: task.dueDate,
    };
    const optimistic = {
      startDateIso: startIso,
      dueDateIso: dueIso,
      dueDate: dayFromIso(dueIso)?.toLocaleDateString() ?? null,
    };

    writeEpochRef.current += 1;
    setTasks((current) =>
      current.map((item) => (item.id === taskId ? { ...item, ...optimistic } : item)),
    );

    if (!task.dbId) return;
    pendingWritesRef.current.add(taskId);

    void (async () => {
      try {
        const response = await fetch(`/api/planning/tasks/${task.dbId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate: startIso, dueDate: dueIso }),
        });
        if (!response.ok) {
          throw new Error('Save failed');
        }
      } catch {
        setTasks((current) =>
          current.map((item) => (item.id === taskId ? { ...item, ...previous } : item)),
        );
        banner.error('Could not save the new dates — the task has been put back.');
      } finally {
        pendingWritesRef.current.delete(taskId);
      }
    })();
  };
  useEffect(() => {
    const controller = new AbortController();
    fetchTasks(controller.signal)
      .then((nextTasks) => {
        setTasks(nextTasks);
      })
      .catch(() => {
        // ignore
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const epochAtFetch = writeEpochRef.current;
      fetchTasks()
        .then((nextTasks) => {
          mergeFetchedTasks(nextTasks, epochAtFetch);
        })
        .catch(() => {
          // ignore
        });
    }, 10000);

    return () => clearInterval(interval);
  }, [mergeFetchedTasks]);

  useEffect(() => {
    let isActive = true;

    const loadNotifications = async () => {
      try {
        const response = await fetch('/api/planning/notifications', { credentials: 'include' });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as { notifications?: NotificationItem[] } | null;
        if (!isActive) {
          return;
        }
        setNotifications(data?.notifications ?? []);
      } catch {
        // ignore
      }
    };

    loadNotifications().catch(() => {
      // ignore
    });

    return () => {
      isActive = false;
    };
  }, []);

  const statusOptions = Array.from(new Set([...kanbanColumns, ...tasks.map((task) => task.status)]));

  const addKanbanColumn = () => {
    const next = newColumnName.trim();
    if (!next) {
      return;
    }
    if (kanbanColumns.includes(next)) {
      setNewColumnName('');
      return;
    }
    setKanbanColumns((current) => [...current, next]);
    setColumnColors((current) => ({
      ...current,
      [next]: newColumnColor,
    }));
    setNewColumnName('');
    setNewColumnColor('#60A5FA');
    setShowAddColumn(false);
  };

  const renameKanbanColumn = async (column: string) => {
    const next = (renameDrafts[column] ?? column).trim();
    if (!next || next === column) {
      return;
    }
    if (kanbanColumns.includes(next)) {
      return;
    }
    setKanbanColumns((current) => current.map((item) => (item === column ? next : item)));
    setColumnColors((current) => {
      const nextColors = { ...current };
      if (nextColors[column]) {
        nextColors[next] = nextColors[column];
        delete nextColors[column];
      }
      return nextColors;
    });
    setRenameDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[column];
      return nextDrafts;
    });
    const impacted = tasks.filter((task) => task.status === column && task.dbId);
    if (impacted.length > 0) {
      await Promise.all(
        impacted.map((task) => updateTaskStatus(task, next)),
      );
    }
  };

  const removeKanbanColumn = async (column: string) => {
    if (kanbanColumns.length <= 1) {
      return;
    }
    const remaining = kanbanColumns.filter((item) => item !== column);
    const fallback = remaining[0] ?? 'Backlog';
    setKanbanColumns(remaining.length > 0 ? remaining : [fallback]);
    setColumnColors((current) => {
      const nextColors = { ...current };
      delete nextColors[column];
      return nextColors;
    });
    setTasks((current) =>
      current.map((task) =>
        task.status === column ? { ...task, status: fallback } : task,
      ),
    );
    const impacted = tasks.filter((task) => task.status === column && task.dbId);
    if (impacted.length > 0) {
      await Promise.all(
        impacted.map((task) => updateTaskStatus(task, fallback)),
      );
    }
  };

  const updateRenameDraft = (column: string, value: string) => {
    setRenameDrafts((current) => ({
      ...current,
      [column]: value,
    }));
  };

  const updateColumnColor = (column: string, color: string) => {
    setColumnColors((current) => ({
      ...current,
      [column]: color,
    }));
  };

  const renderAssignees = (count: number) => {
    const colors = ['#FF6B9D', '#4ECDC4', '#95E1D3', '#F38181', '#AA96DA'];
    return (
      <div className="flex -space-x-2">
        {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
          <div
            key={`${count}-assignee-${i}`}
            className="w-6 h-6 rounded-full border-2 border-white"
            style={{ backgroundColor: colors[i % 5] }}
          />
        ))}
        {count > 4 && (
          <div className="w-6 h-6 rounded-full border-2 border-white bg-gray-300 flex items-center justify-center text-[10px] font-bold">
            +{count - 4}
          </div>
        )}
      </div>
    );
  };

  const views: Array<{ id: ViewType; label: string; icon: string }> = [
    { id: 'list', label: 'List', icon: '≡' },
    { id: 'kanban', label: 'Kanban', icon: '⊞' },
    { id: 'gantt', label: 'Gantt', icon: '⊢' },
    { id: 'calendar', label: 'Calendar', icon: '📅' },
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  ];

  const clearRenameDraft = (col: string) => {
    setRenameDrafts((d) => {
      const next = { ...d };
      delete next[col];
      return next;
    });
  };

  const openNewTaskInColumn = (col: string) => {
    resetCreateDrawer();
    setCreateTask((t) => ({ ...t, status: col }));
    setShowCreateDrawer(true);
  };

  // Manual board order, applied on top of the server's due-date ordering.
  const orderedKanbanTasks = (list: Task[]) => {
    if (taskOrder.length === 0) return list;
    const rank = new Map(taskOrder.map((id, index) => [id, index]));
    return [...list].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  const renderKanbanView = (visibleTasks: Task[]) => (
    <KanbanBoard
      tasks={orderedKanbanTasks(visibleTasks)}
      columns={kanbanColumns}
      columnColors={columnColors}
      renameDrafts={renameDrafts}
      showAddColumn={showAddColumn}
      newColumnName={newColumnName}
      newColumnColor={newColumnColor}
      isTaskOverdue={(task) => isTaskOverdue(task as Task)}
      onOpenTask={(taskId) => {
        const task = tasks.find((item) => item.id === taskId);
        if (task) openTaskDrawer(task);
      }}
      onMoveTask={(taskId, status) => {
        const task = tasks.find((item) => item.id === taskId);
        if (task && task.status !== status) void updateTaskStatus(task, status);
      }}
      onOrderChange={setTaskOrder}
      onNewTaskInColumn={openNewTaskInColumn}
      onRenameDraftChange={updateRenameDraft}
      onRenameCommit={(column) => void renameKanbanColumn(column)}
      onRenameCancel={clearRenameDraft}
      onColumnColorChange={updateColumnColor}
      onRemoveColumn={(column) => void removeKanbanColumn(column)}
      onAddColumn={addKanbanColumn}
      onShowAddColumnChange={setShowAddColumn}
      onNewColumnNameChange={setNewColumnName}
      onNewColumnColorChange={setNewColumnColor}
    />
  );

  const renderListView = (tasks: Task[]) => (
    <>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-200">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              draggable
              onDragStart={() => setDraggedTask(task)}
              onDragEnd={() => setDraggedTask(null)}
              onClick={() => {
                openTaskDrawer(task);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  openTaskDrawer(task);
                }
              }}
              className={`w-full text-left p-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-grab active:cursor-grabbing ${
                draggedTask?.id === task.id ? 'opacity-50' : ''
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-500">{task.id}</span>
                  <h3 className="font-medium text-gray-900">{task.title}</h3>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-block px-2 py-1 rounded text-xs font-semibold"
                    style={{
                      backgroundColor: task.priority === 'High' ? '#FEE2E2' : task.priority === 'Medium' ? '#FEF3C7' : '#D1FAE5',
                      color: task.priority === 'High' ? '#991B1B' : task.priority === 'Medium' ? '#92400E' : '#065F46'
                    }}>
                    {task.priority}
                  </span>
                  <span className="text-xs text-gray-500">{task.list}</span>
                  {task.dueDate && <span className="text-xs text-gray-500">{task.dueDate}</span>}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">{task.status}</span>
                {renderAssignees(task.assignees)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Task Drawer - list view instance */}
      {selectedTask && editedTask && (
        <>
          {/* Overlay - Blur background */}
          <button
            type="button"
            className="fixed inset-0 backdrop-blur-sm z-40 transition-opacity duration-300 cursor-default"
            onClick={() => {
              setSelectedTask(null);
              setEditedTask(null);
              setSubtasks([]);
              setCommentInput('');
              setDescription('');
              setDueTime('');
            }}
            aria-label="Close task drawer"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSelectedTask(null);
                setEditedTask(null);
                setSubtasks([]);
                setCommentInput('');
                setDescription('');
                setDueTime('');
              }
            }}
          />
          
          {/* Drawer */}
          <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out">
            {/* Top Action Bar */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
              <p className="text-xs text-gray-500 font-mono">{selectedTask.id}</p>
              <div className="flex items-center gap-3">
                <button className="p-2 text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button className="p-2 text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button className="p-2 text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    setSelectedTask(null);
                    setEditedTask(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Title and Priority */}
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <select
                    value={editedTask.priority}
                    onChange={(event) => handleEditPriorityChange(event.target.value as Task['priority'])}
                    className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <select
                    value={editedTask.status}
                    onChange={(event) => handleEditStatusChange(event.target.value)}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={editedTask.title}
                  onChange={(event) => handleEditTitleChange(event.target.value)}
                  className="w-full text-3xl font-bold text-gray-900 mb-3 border-b border-gray-200 focus:outline-none focus:border-primary"
                  placeholder="Task title"
                />
                <textarea
                  value={description}
                  onChange={(event) => handleEditDescriptionChange(event.target.value)}
                  placeholder="Add a detailed description..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* People Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-900">People</p>
                </div>
                <div className="flex -space-x-2">
                  {renderAssignees(editedTask.assignees)}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {availableUsers.map((user: MentionUser) => {
                    const isTagged = taggedUsers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleTaggedUser(user.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                          isTagged
                            ? 'border-primary/30 bg-primary/5 text-primary'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-primary/20'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full ${user.color} flex items-center justify-center text-[8px] font-bold text-white uppercase`}>
                          {user.initials}
                        </div>
                        {user.name}
                        {isTagged && (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timeline Date */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-900">Timeline Date</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-gray-500">
                    Start
                    <input
                      type="date"
                      value={dateKeyFromIso(editedTask.startDateIso) ?? ''}
                      max={dateKeyFromIso(editedTask.dueDateIso) ?? undefined}
                      onChange={(event) => handleEditStartDateChange(event.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-500">
                    Due
                    <input
                      type="date"
                      value={dateKeyFromIso(editedTask.dueDateIso) ?? ''}
                      min={dateKeyFromIso(editedTask.startDateIso) ?? undefined}
                      onChange={(event) => handleEditDueDateChange(event.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-500 sm:col-span-2">
                    Due time
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(event) => setDueTime(event.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                </div>
              </div>

              {/* Type */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-900">Type</p>
                </div>
                <p className="text-gray-600 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                  </svg>
                  {editedTask.list}
                </p>
              </div>

              {/* Attachments */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-900">Attachments ({attachments.length})</p>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-sm text-gray-500">No attachments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="w-10 h-10 bg-indigo-500 rounded flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{attachment.filename}</p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(attachment.size)} • {new Date(attachment.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <label className="w-full mt-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium">Add Attachment</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => handleAddAttachments(event.target.files)}
                  />
                </label>
              </div>

              {/* Comments */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-gray-900">Comments ({comments.length})</p>
                </div>
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <p className="text-sm text-gray-500">No comments yet.</p>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.id}>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-full bg-gray-300 shrink-0"></div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{comment.author}</p>
                            <p className="text-xs text-gray-500">{comment.time}</p>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 ml-11">{comment.text}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4">
                  <div className="flex items-center gap-2">
                    <input
                      value={commentInput}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      placeholder="Write a comment..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={handleSendComment}
                      className="p-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                      aria-label="Send comment"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12l16-8-4 8 4 8-16-8z" />
                      </svg>
                    </button>
                  </div>
                  {showMentions && (
                    <div className="mt-2 border border-gray-200 rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                      {availableUsers
                        .filter((user: MentionUser) =>
                          user.name.toLowerCase().includes(mentionQuery.toLowerCase()),
                        )
                        .map((user: MentionUser) => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => applyMention(user.name)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                          >
                            <div className={`w-5 h-5 rounded-full ${user.color} flex items-center justify-center text-[8px] font-bold text-white uppercase`}>
                              {user.initials}
                            </div>
                            <span className="text-sm text-gray-700">{user.name}</span>
                          </button>
                        ))}
                      {availableUsers.filter((user: MentionUser) =>
                        user.name.toLowerCase().includes(mentionQuery.toLowerCase()),
                      ).length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Subtasks */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Subtasks</p>
                  </div>
                  {subtasks.length > 0 && (
                    <span className="text-xs font-semibold text-primary">
                      {Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100)}% complete
                    </span>
                  )}
                </div>
                {subtasks.length > 0 && (
                  <div className="mb-3 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100)}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    value={subtaskTitle}
                    onChange={(event) => setSubtaskTitle(event.target.value)}
                    placeholder="Add a subtask"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={handleAddSubtask}
                    className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-3">
                  {subtasks.map((subtask) => (
                    <div key={subtask.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group">
                      <input
                        type="checkbox"
                        checked={subtask.completed}
                        onChange={() => {
                          toggleLegacySubtask(subtask.id);
                        }}
                        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                      />
                      <div className="flex-1">
                        <p className={`text-sm ${subtask.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {subtask.title}
                        </p>
                      </div>
                      <button
                        onClick={() => removeLegacySubtask(subtask.id)}
                        className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
              <button
                onClick={handleSaveTaskChanges}
                className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 font-semibold transition-colors"
              >
                Save Changes
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSelectedTask(null);
                    setEditedTask(null);
                    setSubtasks([]);
                    setCommentInput('');
                    setDescription('');
                    setDueTime('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
                {selectedTask.deletedAt ? (
                  <button
                    onClick={handleRestoreSelectedTask}
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    onClick={handleDeleteSelectedTask}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  const renderCalendarView = (tasks: Task[]) => {
    // Personal tasks shown by their due date, overlaid on the full calendar.
    const taskEvents: CalendarExtraEvent[] = tasks
      .map((task) => {
        const parsed = dayFromIso(task.dueDateIso);
        if (!parsed) return null;
        return {
          key: String(task.id),
          title: task.title,
          startsAt: parsed.toISOString(),
          allDay: true,
          tag: task.priority ?? 'Task',
        } as CalendarExtraEvent;
      })
      .filter((e): e is CalendarExtraEvent => e !== null);

    return <CalendarClient initialEvents={[]} extraEvents={taskEvents} />;
  };

  const renderDashboardView = (tasks: Task[]) => {
    const total = tasks.length;
    const doneStatus = kanbanColumns[kanbanColumns.length - 1] ?? 'In review';
    const doneCount = tasks.filter((task) => task.status === doneStatus).length;
    const completionPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const inProgress = tasks.filter((task) => task.status === 'In progress').length;

    const statusSegments = Array.from(new Set([...kanbanColumns, ...tasks.map((t) => t.status)])).map((name) => ({
      label: name,
      count: tasks.filter((t) => t.status === name).length,
      color: columnColors[name] ?? '#03458f',
    }));

    const priorityRows = [
      { label: 'High', count: tasks.filter((t) => t.priority === 'High').length, color: '#e11d48' },
      { label: 'Medium', count: tasks.filter((t) => t.priority === 'Medium').length, color: '#f59e0b' },
      { label: 'Low', count: tasks.filter((t) => t.priority === 'Low').length, color: '#10b981' },
    ];

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(startToday);
    endToday.setDate(endToday.getDate() + 1);
    const endWeek = new Date(startToday);
    endWeek.setDate(endWeek.getDate() + 7);
    let overdue = 0;
    let dueToday = 0;
    let dueWeek = 0;
    let later = 0;
    let noDate = 0;
    for (const task of tasks) {
      if (!task.dueDateIso) {
        noDate += 1;
        continue;
      }
      const d = new Date(task.dueDateIso).getTime();
      if (d < startToday.getTime()) overdue += 1;
      else if (d < endToday.getTime()) dueToday += 1;
      else if (d < endWeek.getTime()) dueWeek += 1;
      else later += 1;
    }
    const dueRows = [
      { label: 'Overdue', count: overdue, color: '#e11d48' },
      { label: 'Due today', count: dueToday, color: '#f59e0b' },
      { label: 'This week', count: dueWeek, color: '#03458f' },
      { label: 'Later', count: later, color: '#9ca3af' },
      { label: 'No date', count: noDate, color: '#d1d5db' },
    ];

    if (total === 0) {
      return (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-20 text-center">
          <h3 className="text-lg font-semibold text-gray-900">No tasks yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            Create a task and your charts will appear here.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <DashStat label="Total tasks" value={`${total}`} accent="text-primary" />
          <DashStat label="In progress" value={`${inProgress}`} />
          <DashStat label="Due today" value={`${dueToday}`} accent={dueToday > 0 ? 'text-amber-600' : 'text-gray-900'} />
          <DashStat label="Overdue" value={`${overdue}`} accent={overdue > 0 ? 'text-rose-600' : 'text-gray-900'} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <DashCard title="Completion" subtitle={`Tasks in “${doneStatus}”`}>
            <CompletionDonut percent={completionPct} doneCount={doneCount} total={total} />
          </DashCard>
          <DashCard title="By status" subtitle="Distribution across your columns" className="lg:col-span-2">
            <StackedBar segments={statusSegments} total={total} />
          </DashCard>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DashCard title="By priority">
            <BarList rows={priorityRows} />
          </DashCard>
          <DashCard title="By due date">
            <BarList rows={dueRows} />
          </DashCard>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* The timeline wants every pixel it can get; the other views read
          better in a fixed column. */}
      <div className={`mx-auto ${activeView === 'gantt' ? 'max-w-none' : 'max-w-7xl'}`}>
        {notifications.length > 0 && (
          <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-primary">
            <p className="text-sm font-semibold mb-2">Shared with you</p>
            <div className="space-y-2">
              {notifications.slice(0, 3).map((notification) => (
                <div key={notification.id} className="text-sm text-primary">
                  {notification.message}
                  <span className="ml-2 text-xs text-primary">
                    {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
            <p className="text-gray-600 text-sm mt-1">Manage your tasks efficiently</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm font-medium text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 00-1 1v2.586a1 1 0 00.293.707l6.414 6.414a1 1 0 00.293.707V21a1 1 0 001 1h2a1 1 0 001-1v-6.293a1 1 0 00.293-.707l6.414-6.414a1 1 0 00.293-.707V5a1 1 0 00-1-1h-9z" />
              </svg>
              Filter
            </button>
            <button className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm font-medium text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 00-1 1v2.586a1 1 0 00.293.707l6.414 6.414a1 1 0 00.293.707V21a1 1 0 001 1h2a1 1 0 001-1v-6.293a1 1 0 00.293-.707l6.414-6.414a1 1 0 00.293-.707V5a1 1 0 00-1-1h-9z" />
              </svg>
              Sort
            </button>
            <button
              onClick={() => {
                resetCreateDrawer();
                setShowCreateDrawer(true);
              }}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-2 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Task
            </button>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-2 mb-8 bg-white rounded-lg border border-gray-200 p-1 w-fit">
          {views.map((view) => (
            <button
              key={view.id}
              onClick={() => setActiveView(view.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeView === view.id
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span>{view.icon}</span>
              {view.label}
            </button>
          ))}
        </div>

        {/* Scope filter: Active / Completed / Deleted */}
        {activeView !== 'dashboard' && (
          <div className="flex items-center gap-1 mb-6 bg-white rounded-lg border border-gray-200 p-1 w-fit">
            {TASK_SCOPES.map((s) => {
              const count = tasks.filter((t) => taskMatchesScope(t, s)).length;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    scope === s ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {s}
                  <span className={`ml-1.5 text-xs ${scope === s ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Content Area */}
        {activeView === 'kanban' && renderKanbanView(tasks.filter((t) => taskMatchesScope(t, scope)))}
        {activeView === 'list' && renderListView(tasks.filter((t) => taskMatchesScope(t, scope)))}
        {activeView === 'gantt' && (
          <GanttChart
            tasks={orderedKanbanTasks(tasks.filter((t) => taskMatchesScope(t, scope)))}
            columns={kanbanColumns}
            columnColors={columnColors}
            isTaskOverdue={(task) => isTaskOverdue(task as Task)}
            onOpenTask={handleTaskOpenById}
            onReschedule={handleGanttReschedule}
          />
        )}
        {activeView === 'calendar' && renderCalendarView(tasks.filter((t) => taskMatchesScope(t, scope)))}
        {activeView === 'dashboard' && renderDashboardView(tasks.filter((t) => !t.deletedAt))}

        {/* ── Shared task drawer (Kanban / Gantt / Calendar views) ── */}
        {activeView !== 'list' && selectedTask && editedTask && (
          <>
            <button
              type="button"
              className="fixed inset-0 backdrop-blur-sm z-40 transition-opacity duration-300 cursor-default"
              onClick={() => {
                setSelectedTask(null);
                setEditedTask(null);
                setSubtasks([]);
                setCommentInput('');
                setDescription('');
                setDueTime('');
              }}
              aria-label="Close task drawer"
            />
            <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <p className="text-xs font-mono text-gray-500">{selectedTask.id}</p>
                <button
                  type="button"
                  onClick={() => { setSelectedTask(null); setEditedTask(null); }}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="p-6">
                {/* Priority + Status + Title + Description */}
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <select
                      value={editedTask.priority}
                      onChange={(e) => handleEditPriorityChange(e.target.value as Task['priority'])}
                      className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold"
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                    <select
                      value={editedTask.status}
                      onChange={(e) => handleEditStatusChange(e.target.value)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold"
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={editedTask.title}
                    onChange={(e) => handleEditTitleChange(e.target.value)}
                    className="w-full text-3xl font-bold text-gray-900 mb-3 border-b border-gray-200 focus:outline-none focus:border-primary"
                    placeholder="Task title"
                  />
                  <textarea
                    value={description}
                    onChange={(e) => handleEditDescriptionChange(e.target.value)}
                    placeholder="Add a detailed description..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>

                {/* People */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900 mb-3">People</p>
                  <div className="flex flex-wrap gap-2">
                    {availableUsers.map((user) => {
                      const isTagged = taggedUsers.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => toggleTaggedUser(user.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${isTagged ? 'border-primary/30 bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary/20'}`}
                        >
                          <div className={`w-5 h-5 rounded-full ${user.color} flex items-center justify-center text-[8px] font-bold text-white`}>
                            {user.initials}
                          </div>
                          {user.name}
                          {isTagged && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Due date */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Dates</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-gray-500">
                      Start
                      <input
                        type="date"
                        value={dateKeyFromIso(editedTask.startDateIso) ?? ''}
                        max={dateKeyFromIso(editedTask.dueDateIso) ?? undefined}
                        onChange={(e) => handleEditStartDateChange(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-500">
                      Due
                      <input
                        type="date"
                        value={dateKeyFromIso(editedTask.dueDateIso) ?? ''}
                        min={dateKeyFromIso(editedTask.startDateIso) ?? undefined}
                        onChange={(e) => handleEditDueDateChange(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-500 col-span-2">
                      Due time
                      <input
                        type="time"
                        value={dueTime}
                        onChange={(e) => setDueTime(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </label>
                  </div>
                </div>

                {/* Attachments */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Attachments ({attachments.length})</p>
                  {attachments.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {attachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{att.filename}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(att.size)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-2 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 cursor-pointer">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    <span className="text-sm">Add Attachment</span>
                    <input type="file" multiple className="hidden" onChange={(e) => handleAddAttachments(e.target.files)} />
                  </label>
                </div>

                {/* Comments */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Comments ({comments.length})</p>
                  <div className="space-y-4 mb-4">
                    {comments.length === 0 ? (
                      <p className="text-sm text-gray-500">No comments yet.</p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id}>
                          <div className="flex items-center gap-3 mb-1">
                            <div className="w-7 h-7 rounded-full bg-gray-300 shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-gray-900">{c.author}</p>
                              <p className="text-xs text-gray-500">{c.time}</p>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 ml-10">{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={commentInput}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      placeholder="Write a comment..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSendComment(); }}
                    />
                    <button type="button" onClick={handleSendComment} className="p-2 bg-primary text-white rounded-lg hover:bg-primary/90" aria-label="Send comment">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12l16-8-4 8 4 8-16-8z" /></svg>
                    </button>
                  </div>
                </div>

                {/* Subtasks */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-900">Subtasks</p>
                    {subtasks.length > 0 && (
                      <span className="text-xs font-semibold text-primary">
                        {Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100)}% complete
                      </span>
                    )}
                  </div>
                  {subtasks.length > 0 && (
                    <div className="mb-3 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100)}%` }}
                      />
                    </div>
                  )}
                  <div className="flex gap-2 mb-3">
                    <input
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      placeholder="Add a subtask"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(); }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button type="button" onClick={handleAddSubtask} className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90">Add</button>
                  </div>
                  <div className="space-y-2">
                    {subtasks.map((st) => (
                      <div key={st.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg group hover:bg-gray-100">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => toggleLegacySubtask(st.id)}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                        <p className={`flex-1 text-sm ${st.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>{st.title}</p>
                        <button type="button" onClick={() => removeLegacySubtask(st.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
                <button
                  type="button"
                  onClick={handleSaveTaskChanges}
                  className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 font-semibold"
                >
                  Save Changes
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTask(null);
                      setEditedTask(null);
                      setSubtasks([]);
                      setCommentInput('');
                      setDescription('');
                      setDueTime('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                  >
                    Cancel
                  </button>
                  {selectedTask.deletedAt ? (
                    <button
                      type="button"
                      onClick={handleRestoreSelectedTask}
                      className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDeleteSelectedTask}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {showCreateDrawer && (
          <>
            <button
              type="button"
              className="fixed inset-0 backdrop-blur-sm z-40 transition-opacity duration-300 cursor-default"
              onClick={() => {
                setShowCreateDrawer(false);
                resetCreateDrawer();
              }}
              aria-label="Close create task drawer"
            />

            <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <p className="text-xs text-gray-500">Create new task</p>
                <button
                  onClick={() => {
                    setShowCreateDrawer(false);
                    resetCreateDrawer();
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <select
                      value={createTask.priority}
                      onChange={(e) => setCreateTask((current) => ({ ...current, priority: e.target.value as Task['priority'] }))}
                      className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold"
                    >
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                    <select
                      value={createTask.status}
                      onChange={(e) => setCreateTask((current) => ({ ...current, status: e.target.value }))}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={createTask.title}
                    onChange={(e) => setCreateTask((current) => ({ ...current, title: e.target.value }))}
                    placeholder="Task title"
                    className="w-full text-3xl font-bold text-gray-900 mb-3 border-b border-gray-200 focus:outline-none focus:border-primary"
                  />
                  <textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="Add a detailed description..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  {createError && (
                    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {createError}
                    </div>
                  )}
                </div>

                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Assignees</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableUsers.map((user: MentionUser) => {
                      const isTagged = createTaggedUsers.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => toggleCreateTaggedUser(user.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                            isTagged
                              ? 'border-primary/30 bg-primary/5 text-primary'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-primary/20'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full ${user.color} flex items-center justify-center text-[8px] font-bold text-white uppercase`}>
                            {user.initials}
                          </div>
                          {user.name}
                          {isTagged && (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Timeline Date</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={createTask.dueDate ?? ''}
                      onChange={(e) => setCreateTask((current) => ({ ...current, dueDate: e.target.value || null }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <input
                      type="time"
                      value={createDueTime}
                      onChange={(e) => setCreateDueTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Type</p>
                  </div>
                  <input
                    value={createTask.list}
                    onChange={(e) => setCreateTask((current) => ({ ...current, list: e.target.value }))}
                    placeholder="Task type"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Attachments</p>
                  </div>
                  <label className="w-full flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 transition-colors cursor-pointer">
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => setCreateAttachments(Array.from(e.target.files ?? []))}
                    />
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-sm font-medium">Add attachments (any file type)</span>
                  </label>
                  {createAttachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {createAttachments.map((file) => (
                        <div key={file.name} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-gray-500">{Math.round(file.size / 1024)} KB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-900">Subtasks</p>
                  </div>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={createSubtaskTitle}
                      onChange={(e) => setCreateSubtaskTitle(e.target.value)}
                      placeholder="New subtask"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={addCreateSubtask}
                      className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                    >
                      Add
                    </button>
                  </div>
                  <div className="space-y-3">
                    {createSubtasks.map((subtask) => (
                      <div key={subtask.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <input
                          type="checkbox"
                          checked={subtask.completed}
                          onChange={() => toggleCreateSubtask(subtask.id)}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <p className="flex-1 text-sm text-gray-900">{subtask.title}</p>
                        <button
                          type="button"
                          onClick={() => removeCreateSubtask(subtask.id)}
                          className="text-gray-300 hover:text-red-600"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <label htmlFor="create-notes" className="block text-sm font-semibold text-gray-900 mb-3">Notes</label>
                  <textarea
                    id="create-notes"
                    value={createNotes}
                    onChange={(e) => handleCreateNotesChange(e.target.value)}
                    placeholder="Add notes..."
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  {showCreateMentions && (
                    <div className="mt-2 border border-gray-200 rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                      {availableUsers
                        .filter((user: MentionUser) =>
                          user.name.toLowerCase().includes(createMentionQuery.toLowerCase()),
                        )
                        .map((user: MentionUser) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => applyCreateMention(user.name)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                        >
                          <div className={`w-5 h-5 rounded-full ${user.color} flex items-center justify-center text-[8px] font-bold text-white uppercase`}>
                            {user.initials}
                          </div>
                          <span className="text-sm text-gray-700">{user.name}</span>
                        </button>
                      ))}
                      {availableUsers.filter((user: MentionUser) =>
                        user.name.toLowerCase().includes(createMentionQuery.toLowerCase()),
                      ).length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
                <button
                  onClick={handleCreateDrawerSave}
                  className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 font-semibold transition-colors"
                >
                  Save Task
                </button>
                <button
                  onClick={() => {
                    setShowCreateDrawer(false);
                    resetCreateDrawer();
                  }}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
