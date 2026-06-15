'use client';

import React, { useEffect, useRef, useState } from 'react';

import CalendarClient, { type CalendarExtraEvent } from '@/app/modules/calendar/calendar-client';


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
  status: string;
  assignees: number;
};

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
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

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
        status,
        assignees: 0,
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
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
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
          | { board?: { columns?: string[]; columnColors?: Record<string, string> | null } | null }
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
  }, [kanbanColumns, columnColors]);

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
    const isoValue = value ? new Date(value).toISOString() : null;
    const displayValue = value ? new Date(value).toLocaleDateString() : null;
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
          const base = finalDueDate.slice(0, 10);
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
  const handleDeleteSelectedTask = () => {
    if (!selectedTask) return;
    const taskToDelete = selectedTask;
    setTasks((ts) => ts.filter((t) => t.id !== taskToDelete.id));
    setSelectedTask(null);
    setEditedTask(null);
    setSubtasks([]);
    setCommentInput('');
    setDescription('');
    setDueTime('');
    if (taskToDelete.dbId) {
      fetch(`/api/planning/tasks/${taskToDelete.dbId}`, {
        method: 'DELETE',
        credentials: 'include',
      }).catch(() => { /* ignore */ });
    }
  };

  const handleKanbanDragOver = (event: React.DragEvent<HTMLUListElement>) => {
    event.preventDefault();
    const status = event.currentTarget.dataset.status ?? null;
    if (status && status !== dragOverColumn) {
      setDragOverColumn(status);
    }
  };
  const handleKanbanDrop = (event: React.DragEvent<HTMLUListElement>) => {
    event.preventDefault();
    const nextStatus = event.currentTarget.dataset.status;
    setDragOverColumn(null);
    if (draggedTask && nextStatus && draggedTask.status !== nextStatus) {
      updateTaskStatus(draggedTask, nextStatus);
    }
    setDraggedTask(null);
  };
  const handleKanbanDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    const taskId = event.currentTarget.dataset.taskId;
    if (!taskId) {
      return;
    }
    const task = tasks.find((item) => item.id === taskId);
    if (task) {
      setDraggedTask(task);
    }
  };
  const handleKanbanDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const DONE_COLUMN_RE = /done|complete|closed|review|shipped/i;
  const isTaskOverdue = (task: Task) => {
    if (DONE_COLUMN_RE.test(task.status)) return false;
    const raw = task.dueDateIso ?? task.dueDate ?? '';
    if (!raw) return false;
    const due = new Date(raw);
    if (Number.isNaN(due.getTime())) return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return due < startOfToday;
  };
  const handleKanbanTaskOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    const taskId = event.currentTarget.dataset.taskId;
    if (!taskId) {
      return;
    }
    const task = tasks.find((item) => item.id === taskId);
    if (task) {
      openTaskDrawer(task);
    }
  };

  const handleGanttTaskOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    const taskId = event.currentTarget.dataset.taskId;
    if (!taskId) return;
    const task = tasks.find((item) => item.id === taskId);
    if (task) openTaskDrawer(task);
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
      fetchTasks()
        .then((nextTasks) => {
          setTasks(nextTasks);
        })
        .catch(() => {
          // ignore
        });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

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

  const getTasksByStatus = (status: string) => {
    return tasks.filter(task => task.status === status);
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

  const getPriorityStyle = (priority: Task['priority']) => {
    if (priority === 'High') return { bg: 'bg-rose-50', text: 'text-rose-600', dot: '#f43f5e' };
    if (priority === 'Medium') return { bg: 'bg-amber-50', text: 'text-amber-600', dot: '#f59e0b' };
    return { bg: 'bg-primary/5', text: 'text-primary', dot: '#10b981' };
  };

  const renderKanbanView = () => (
    <div className="flex flex-col gap-6">
      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {kanbanColumns.map((status) => {
          const statusTasks = getTasksByStatus(status);
          const accentColor = columnColors[status] ?? '#6366f1';
          const total = tasks.length;
          const sharePct = total > 0 ? Math.round((statusTasks.length / total) * 100) : 0;
          const isDropTarget = dragOverColumn === status;

          return (
            <div
              key={status}
              className={`flex min-w-68 flex-1 flex-col overflow-hidden rounded-2xl border bg-white transition-shadow ${
                isDropTarget ? 'border-transparent shadow-lg' : 'border-slate-200 shadow-sm'
              }`}
              style={isDropTarget ? { boxShadow: `0 0 0 2px ${accentColor}` } : undefined}
            >
              {/* Column Header (tinted accent band) */}
              <div className="px-4 pt-4 pb-3" style={{ backgroundColor: `${accentColor}14` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
                    {status in renameDrafts ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renameDrafts[status]}
                          onChange={(e) => updateRenameDraft(status, e.target.value)}
                          onBlur={() => renameKanbanColumn(status)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { void renameKanbanColumn(status); }
                            if (e.key === 'Escape') { clearRenameDraft(status); }
                          }}
                          className="w-28 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={() => renameKanbanColumn(status)}
                          className="text-[11px] font-semibold text-primary hover:text-primary"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-bold text-slate-800 hover:text-slate-900"
                        onClick={() => updateRenameDraft(status, status)}
                        title="Click to rename"
                      >
                        {status}
                      </button>
                    )}
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">
                      {statusTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => updateColumnColor(status, e.target.value)}
                      className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      title="Column colour"
                    />
                    <button
                      type="button"
                      onClick={() => removeKanbanColumn(status)}
                      className="rounded p-0.5 text-slate-400 hover:text-rose-500"
                      title="Remove column"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Column progress / share bar */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/70">
                    <div className="h-full rounded-full transition-all" style={{ width: `${sharePct}%`, backgroundColor: accentColor }} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500" title="Share of all tasks">{sharePct}%</span>
                </div>
              </div>

              {/* Task Cards */}
              <ul
                className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-3 pt-3 transition-colors"
                style={{ minHeight: '22rem', backgroundColor: isDropTarget ? `${accentColor}0d` : undefined }}
                data-status={status}
                onDragOver={handleKanbanDragOver}
                onDrop={handleKanbanDrop}
                aria-label={`${status} tasks`}
              >
                {statusTasks.length > 0 ? (
                  statusTasks.map((task) => {
                    const pr = getPriorityStyle(task.priority);
                    const overdue = isTaskOverdue(task);
                    return (
                      <li key={task.id}>
                        <button
                          draggable
                          data-task-id={task.id}
                          onDragStart={handleKanbanDragStart}
                          onDragEnd={handleKanbanDragEnd}
                          onClick={handleKanbanTaskOpen}
                          type="button"
                          style={{ borderLeftColor: pr.dot, borderLeftWidth: '4px' }}
                          className={`w-full cursor-grab rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all duration-150 active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.12)] ${
                            draggedTask?.id === task.id ? 'opacity-50' : ''
                          }`}
                        >
                          {/* Top row: id + 3-dot */}
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-slate-400">{task.id}</span>
                            <svg className="h-4 w-4 text-slate-300" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </div>

                          {/* Title */}
                          <p className="text-[13.5px] font-semibold leading-snug text-slate-900">{task.title}</p>

                          {/* Tags row */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pr.bg} ${pr.text}`}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pr.dot }} />
                              {task.priority}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              {task.list}
                            </span>
                          </div>

                          {/* Footer: due date + assignees */}
                          <div className="mt-3 flex items-center justify-between">
                            {task.dueDate ? (
                              <div
                                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  overdue ? 'bg-rose-50 text-rose-600' : 'text-slate-400'
                                }`}
                              >
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  {overdue ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                  ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  )}
                                </svg>
                                {task.dueDate}
                                {overdue && <span className="ml-0.5">· Overdue</span>}
                              </div>
                            ) : <span />}
                            {task.assignees > 0 && renderAssignees(task.assignees)}
                          </div>
                        </button>
                      </li>
                    );
                  })
                ) : (
                  <li
                    className={`flex h-24 items-center justify-center rounded-xl border border-dashed text-[13px] transition-colors ${
                      isDropTarget ? 'border-transparent text-slate-500' : 'border-slate-200 text-slate-400'
                    }`}
                  >
                    {isDropTarget ? 'Drop here' : 'No tasks yet'}
                  </li>
                )}
              </ul>

              {/* Add task inline button */}
              <button
                type="button"
                onClick={() => openNewTaskInColumn(status)}
                className="mx-3 mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New task
              </button>
            </div>
          );
        })}

        {/* Add column */}
        <div className="min-w-68 flex-1">
          {showAddColumn ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-4">
              <p className="text-xs font-semibold text-slate-600">New column</p>
              <input
                id="kanban-inline-column-name"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="Column name…"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') addKanbanColumn(); }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex items-center gap-2">
                <label htmlFor="kanban-inline-column-color" className="text-xs font-medium text-slate-500">Colour</label>
                <input
                  id="kanban-inline-column-color"
                  type="color"
                  value={newColumnColor}
                  onChange={(e) => setNewColumnColor(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-slate-200"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAddColumn(false); setNewColumnName(''); }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >Cancel</button>
                <button
                  type="button"
                  onClick={addKanbanColumn}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                >Add column</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddColumn(true)}
              className="flex h-full min-h-56 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-transparent text-[13px] font-medium text-slate-500 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add list
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderListView = () => (
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
                  <input
                    type="date"
                    value={editedTask.dueDateIso ? editedTask.dueDateIso.slice(0, 10) : ''}
                    onChange={(event) => handleEditDueDateChange(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <input
                    type="time"
                    value={dueTime}
                    onChange={(event) => setDueTime(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
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
                <button
                  onClick={handleDeleteSelectedTask}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  const renderGanttView = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use ISO dates for reliable parsing
    const dueDates = tasks
      .map((task) => {
        const raw = task.dueDateIso ?? task.dueDate;
        if (!raw) return null;
        const d = new Date(raw);
        d.setHours(0, 0, 0, 0);
        return Number.isNaN(d.getTime()) ? null : d;
      })
      .filter((d): d is Date => d !== null);

    // Timeline starts 2 days before earliest due date (or today), ends 4 days after latest
    const earliestDue = dueDates.length > 0 ? new Date(Math.min(...dueDates.map((d) => d.getTime()))) : new Date(today);
    const latestDue  = dueDates.length > 0 ? new Date(Math.max(...dueDates.map((d) => d.getTime()))) : new Date(today);

    const ganttStartDate = new Date(earliestDue);
    ganttStartDate.setDate(ganttStartDate.getDate() - 3);

    const ganttEndDate = new Date(latestDue);
    ganttEndDate.setDate(ganttEndDate.getDate() + 5);

    const ganttDays = Math.max(10, Math.ceil((ganttEndDate.getTime() - ganttStartDate.getTime()) / 86_400_000) + 1);

    const days = Array.from({ length: ganttDays }, (_, i) => {
      const date = new Date(ganttStartDate);
      date.setDate(date.getDate() + i);
      return date;
    });

    // Each column is exactly (1 / ganttDays * 100)% wide.
    // Bar ENDS on the due date column; spans BAR_SPAN_DAYS wide (or fewer if near start).
    const COL_PCT = 100 / ganttDays;
    const BAR_SPAN_DAYS = 4;

    const getTaskPosition = (task: Task) => {
      const raw = task.dueDateIso ?? task.dueDate;
      if (!raw) return null;
      const dueDay = new Date(raw);
      dueDay.setHours(0, 0, 0, 0);
      if (Number.isNaN(dueDay.getTime())) return null;

      // Index of the due-date column (0-based)
      const dueIndex = Math.round((dueDay.getTime() - ganttStartDate.getTime()) / 86_400_000);
      if (dueIndex < 0 || dueIndex >= ganttDays) return null;

      const spanCols = Math.min(BAR_SPAN_DAYS, dueIndex + 1); // can't go before column 0
      const startCol = dueIndex - spanCols + 1;

      return {
        left: `${startCol * COL_PCT}%`,
        width: `${spanCols * COL_PCT}%`,
        isOverdue: dueDay < today,
      };
    };

    const GANTT_BAR_COLORS: Record<string, string> = {
      Backlog: '#94a3b8',
      'In progress': '#6366f1',
      'In review': '#10b981',
    };
    const PRIORITY_BAR_COLORS: Record<string, string> = {
      High: '#f43f5e',
      Medium: '#f59e0b',
      Low: '#38bdf8',
    };

    const todayIndex = Math.round((today.getTime() - ganttStartDate.getTime()) / 86_400_000);
    const todayPosition = (todayIndex / ganttDays) * 100;

    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ROW_H = 56;

    return (
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.2)]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Timeline</h3>
            <p className="text-xs text-slate-500">Task schedule across time.</p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            {Object.entries(GANTT_BAR_COLORS).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <div className="flex" style={{ minWidth: `${Math.max(900, 192 + ganttDays * 48)}px` }}>

            {/* Left sidebar */}
            <div className="w-48 shrink-0 border-r border-slate-100 bg-[#f8fafc]">
              {/* Header row */}
              <div className="flex h-12 items-center border-b border-slate-100 px-4">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Task</span>
              </div>
              {tasks.map((task) => {
                const barColor = GANTT_BAR_COLORS[task.status] ?? PRIORITY_BAR_COLORS[task.priority] ?? '#94a3b8';
                return (
                  <button
                    key={task.id}
                    type="button"
                    data-task-id={task.id}
                    className="flex w-full items-center gap-2.5 border-b border-slate-100 px-4 transition-colors hover:bg-slate-50 cursor-pointer text-left"
                    style={{ height: ROW_H }}
                    onClick={handleGanttTaskOpen}
                  >
                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: barColor }} />
                    <p className="truncate text-[13px] font-medium text-slate-800">{task.title}</p>
                  </button>
                );
              })}
            </div>

            {/* Timeline grid */}
            <div className="relative flex-1">
              {/* Today line */}
              {todayPosition >= 0 && todayPosition <= 100 && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-indigo-500"
                  style={{ left: `${todayPosition}%` }}
                >
                  <span className="absolute -top-1 left-1 rounded bg-indigo-500 px-1 py-0.5 text-[9px] font-bold text-white leading-none">
                    Today
                  </span>
                </div>
              )}

              {/* Date header */}
              <div className="flex h-12 border-b border-slate-100 bg-[#f8fafc]">
                {days.map((date) => {
                  const isToday =
                    date.getFullYear() === today.getFullYear() &&
                    date.getMonth() === today.getMonth() &&
                    date.getDate() === today.getDate();
                  return (
                    <div
                      key={date.toISOString()}
                      className={`flex flex-1 flex-col items-center justify-center border-r border-slate-100 last:border-r-0 ${
                        isToday ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <span className={`text-[9px] font-medium uppercase ${isToday ? 'text-indigo-400' : 'text-slate-400'}`}>
                        {weekDays[date.getDay()]}
                      </span>
                      <span className={`text-[11px] font-bold ${isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                        {date.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Rows */}
              {tasks.map((task) => {
                return (
                  <div
                    key={task.id}
                    className="relative flex border-b border-slate-100 last:border-b-0"
                    style={{ height: ROW_H }}
                  >
                    {/* Grid lines */}
                    {days.map((date) => (
                      <div
                        key={date.toISOString()}
                        className="flex-1 border-r border-slate-100/70 last:border-r-0"
                      />
                    ))}
                    {/* Bar */}
                    {(() => {
                      const pos = getTaskPosition(task);
                      if (!pos) return null;
                      const barColor = GANTT_BAR_COLORS[task.status] ?? PRIORITY_BAR_COLORS[task.priority] ?? '#94a3b8';
                      const barBg = pos.isOverdue ? '#f43f5e' : barColor;
                      return (
                        <div className="absolute inset-y-0 flex items-center" style={{ left: pos.left, width: pos.width }}>
                          <button
                            type="button"
                            data-task-id={task.id}
                            className="relative mx-1 flex h-8 w-full items-center overflow-hidden rounded-lg px-3 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-all hover:brightness-110"
                            style={{ backgroundColor: barBg }}
                            title={task.title}
                            onClick={handleGanttTaskOpen}
                          >
                            <span className="truncate drop-shadow-sm">{task.title}</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {tasks.length === 0 && (
                <div className="flex h-32 items-center justify-center text-sm text-slate-400">
                  No tasks to display on the timeline.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCalendarView = () => {
    // Personal tasks shown by their due date, overlaid on the full calendar.
    const taskEvents: CalendarExtraEvent[] = tasks
      .map((task) => {
        const raw = task.dueDateIso ?? task.dueDate ?? '';
        if (!raw) return null;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
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

  const renderDashboardView = () => {
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
      <div className="max-w-7xl mx-auto">
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
            <h1 className="text-3xl font-bold text-gray-900">Personal To-do</h1>
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

        {/* Content Area */}
        {activeView === 'kanban' && renderKanbanView()}
        {activeView === 'list' && renderListView()}
        {activeView === 'gantt' && renderGanttView()}
        {activeView === 'calendar' && renderCalendarView()}
        {activeView === 'dashboard' && renderDashboardView()}

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
                  <p className="text-sm font-semibold text-gray-900 mb-3">Due Date</p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={editedTask.dueDateIso ? editedTask.dueDateIso.slice(0, 10) : ''}
                      onChange={(e) => handleEditDueDateChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
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
                  <button
                    type="button"
                    onClick={handleDeleteSelectedTask}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                  >
                    Delete
                  </button>
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
