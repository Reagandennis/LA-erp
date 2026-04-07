'use client';

import React, { useEffect, useRef, useState } from 'react';

const STATUS_COLORS = {
  Backlog: 'bg-gray-50',
  'In progress': 'bg-orange-50',
  'In review': 'bg-green-50',
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
  priority: 'High' | 'Medium' | 'Low';
  list: string;
  dueDate: string | null;
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
        priority: priority as Task['priority'],
        list: task.isShared ? 'Shared' : 'Personal',
        dueDate,
        status,
        assignees: 0,
      };
    });
  } catch {
    return [];
  }
};

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
    updateSubtasks(subtasksByTask[task.id] ?? []);
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
  };
  const handleCreateDrawerSave = async () => {
    if (!createTask.title.trim()) {
      return;
    }
    setCreateError('');
    const generatedId = createTask.id.trim() || `NT-${createIdRef.current++}`;
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
        [generatedId]: createSubtasks,
      }));
    }
    if (createNotes.trim().length > 0) {
      const seededComment: CommentItem = {
        id: `${generatedId}-c-${createIdRef.current++}`,
        author: 'You',
        time: 'just now',
        text: createNotes.trim(),
      };
      setCommentsByTask((current) => ({
        ...current,
        [generatedId]: [seededComment],
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
        const response = await fetch(`/api/planning/tasks/${selectedTask.dbId}/attachments`, {
          credentials: 'include',
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json().catch(() => null)) as { attachments?: AttachmentItem[] } | null;
        if (!isActive) {
          return;
        }
        const nextAttachments = data?.attachments ?? [];
        setAttachments(nextAttachments);
        setAttachmentsByTask((current) => ({
          ...current,
          [selectedTask.id]: nextAttachments,
        }));
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
  const handleKanbanDragOver = (event: React.DragEvent<HTMLUListElement>) => {
    event.preventDefault();
  };
  const handleKanbanDrop = (event: React.DragEvent<HTMLUListElement>) => {
    event.preventDefault();
    const nextStatus = event.currentTarget.dataset.status;
    if (draggedTask && nextStatus && draggedTask.status !== nextStatus) {
      updateTaskStatus(draggedTask, nextStatus);
      setDraggedTask(null);
    }
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

  const statuses = ['Backlog', 'In progress', 'In review'];

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

  const renderKanbanView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {statuses.map((status) => {
        const statusTasks = getTasksByStatus(status);
        const statusLabel = status === 'Backlog' ? 'Backlog' : status === 'In progress' ? 'In progress' : 'In review';
        
        return (
          <div key={status} className={`rounded-lg border border-gray-200 overflow-hidden`}>
            {/* Column Header */}
            <div className={`p-4 border-b border-gray-200 ${STATUS_COLORS[status as keyof typeof STATUS_COLORS]}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  {statusLabel}{' '}
                  <span className="inline-block ml-2 px-2.5 py-0.5 text-xs font-semibold text-gray-600 bg-white rounded-full">
                    {statusTasks.length}
                  </span>
                </h2>
                <button className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tasks Container */}
            <ul
              className={`p-4 space-y-3 min-h-96 overflow-y-auto ${STATUS_COLORS[status as keyof typeof STATUS_COLORS]}`}
              data-status={status}
              onDragOver={handleKanbanDragOver}
              onDrop={handleKanbanDrop}
              aria-label={`${statusLabel} tasks`}
            >
              {statusTasks.length > 0 ? (
                statusTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      draggable
                      data-task-id={task.id}
                      onDragStart={handleKanbanDragStart}
                      onDragEnd={handleKanbanDragEnd}
                      onClick={handleKanbanTaskOpen}
                      type="button"
                      className={`w-full text-left bg-white p-4 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing ${
                        draggedTask?.id === task.id ? 'opacity-60' : ''
                      }`}
                    >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-500">{task.id}</span>
                    </div>
                    <h3 className="text-sm font-medium text-gray-900 mb-3">{task.title}</h3>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-block px-2 py-1 rounded text-xs font-semibold"
                          style={{
                            backgroundColor: task.priority === 'High' ? '#FEE2E2' : task.priority === 'Medium' ? '#FEF3C7' : '#D1FAE5',
                            color: task.priority === 'High' ? '#991B1B' : task.priority === 'Medium' ? '#92400E' : '#065F46'
                          }}>
                          {task.priority}
                        </span>
                        <span className="text-gray-500">{task.list}</span>
                      </div>

                      {task.dueDate && (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {task.dueDate}
                        </div>
                      )}

                      {task.assignees > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                          {renderAssignees(task.assignees)}
                        </div>
                      )}
                    </div>
                    </button>
                  </li>
                ))
              ) : (
                <li className="flex items-center justify-center h-32 text-gray-400">
                  <p className="text-sm">No tasks</p>
                </li>
              )}
            </ul>
          </div>
        );
      })}
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

      {/* Task Drawer */}
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
              <p className="text-xs text-gray-500">Created on 27 May 2024</p>
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
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                    </svg>
                    {editedTask.priority}
                  </span>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-3">{editedTask.title}</h1>
                <p className="text-gray-600">{description || 'Add a detailed description...'}</p>
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
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-200'
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
                <p className="text-gray-600 text-sm">{editedTask.dueDate} {dueTime && `- ${dueTime}`}</p>
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
                <button className="w-full mt-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 transition-colors flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium">Add Attachment</span>
                </button>
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
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleSendComment}
                      className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
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
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-900">Subtask</p>
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
                        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <div className="flex-1">
                        <p className={`text-sm ${subtask.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {subtask.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Evaluate the software&apos;s speed, responsiveness, and resource usage</p>
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
                onClick={() => {
                  const updatedTasks = tasks.map(t => t.id === editedTask.id ? editedTask : t);
                  setTasks(updatedTasks);
                  setSelectedTask(null);
                  setEditedTask(null);
                  setSubtasks([]);
                  setCommentInput('');
                  setDescription('');
                  setDueTime('');
                }}
                className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors"
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
                  onClick={() => {
                    setTasks(tasks.filter(t => t.id !== selectedTask.id));
                    setSelectedTask(null);
                    setEditedTask(null);
                    setSubtasks([]);
                    setCommentInput('');
                    setDescription('');
                    setDueTime('');
                  }}
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
    const ganttStartDate = new Date(2026, 4, 1); // May 1, 2026
    const ganttDays = 45;
    const today = new Date(2026, 4, 8);

    const days = Array.from({ length: ganttDays }, (_, i) => {
      const date = new Date(ganttStartDate);
      date.setDate(date.getDate() + i);
      return date;
    });

    const getTaskPosition = (task: Task) => {
      if (!task.dueDate) return { left: '0%', width: '8%' };
      const [month, day, year] = task.dueDate.split(' ').reverse();
      const taskDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, Number.parseInt(day));
      const startIndex = Math.floor((taskDate.getTime() - ganttStartDate.getTime()) / (24 * 60 * 60 * 1000));
      const left = (startIndex / ganttDays) * 100;
      const width = Math.max(8, (10 / ganttDays) * 100);
      return { left: Math.max(0, left) + '%', width: width + '%' };
    };

    const GANTT_COLORS: { [key: string]: string } = {
      'Backend improvements': 'bg-blue-500',
      'Improvement for SMS events': 'bg-blue-500',
      'Re-scan all accounts': 'bg-blue-500',
      'Desktop Development': 'bg-emerald-500',
      'Mobile Development': 'bg-orange-500',
      'Monitoring and HealthCheck': 'bg-purple-500',
      'New Registration Flow Exploration': 'bg-blue-500',
      'Gather Requirements': 'bg-cyan-500',
      'Prototyping': 'bg-cyan-500',
      'Prototype Testing': 'bg-cyan-500',
      'Marketing Product': 'bg-teal-500',
      'Project X Planning': 'bg-orange-400',
    };

    const getTodayIndex = Math.floor((today.getTime() - ganttStartDate.getTime()) / (24 * 60 * 60 * 1000));
    const todayPosition = (getTodayIndex / ganttDays) * 100;

    return (
      <div className="p-6 bg-gray-50 rounded-lg">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Gantt Chart</h2>
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <div className="flex">
            {/* Left Sidebar */}
            <div className="shrink-0 w-96 border-r border-gray-200 bg-white">
              <div className="sticky left-0 top-0 bg-gray-50 border-b border-gray-200 px-4 py-3 grid grid-cols-3 gap-4 z-10">
                <p className="text-xs font-semibold text-gray-700 uppercase">Tasks</p>
                <p className="text-xs font-semibold text-gray-700 uppercase text-center">Progress</p>
                <p className="text-xs font-semibold text-gray-700 uppercase text-right">Duration</p>
              </div>
              {/* Task List */}
              {tasks.map((task, idx) => (
                <div key={task.id} className="border-b border-gray-100 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer group">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Progress Circle */}
                      <div className="relative w-8 h-8">
                        <svg className="w-8 h-8 transform -rotate-90" viewBox="0 0 32 32">
                          <circle cx="16" cy="16" r="14" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="2"
                            strokeDasharray={`${(idx % 3 === 0 ? 80 : idx % 3 === 1 ? 100 : 50) / 100 * 88} 88`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-blue-600">
                          {idx % 3 === 0 ? '80%' : idx % 3 === 1 ? '100%' : '50%'}
                        </span>
                      </div>
                      {/* Duration */}
                      <div className="text-xs text-gray-600 w-12 text-right font-medium">
                        {Math.floor(Math.random() * 12) + 3} d
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Gantt Chart */}
            <div className="flex-1 relative">
              {/* Today Indicator */}
              <div className="absolute top-0 bottom-0 w-1 bg-red-500 z-20" style={{ left: todayPosition + '%' }}></div>

              {/* Date Header */}
              <div className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10 flex divide-x divide-gray-200">
                {days.map((date) => (
                  <div
                    key={date.toISOString()}
                    className={`flex-1 px-2 py-3 text-center text-xs font-semibold flex flex-col items-center gap-1 ${
                      date.getTime() === today.getTime()
                        ? 'bg-red-100'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className={date.getTime() === today.getTime() ? 'text-red-700' : 'text-gray-600'}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]}
                    </div>
                    <div className={date.getTime() === today.getTime() ? 'text-red-700 font-bold' : 'text-gray-900 font-bold'}>
                      {date.getDate()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Task Bars */}
              <div className="divide-y divide-gray-100">
                {tasks.map((task) => {
                  const pos = getTaskPosition(task);
                  const colorClass = GANTT_COLORS[task.title] || 'bg-gray-500';
                  return (
                    <div key={task.id} className="flex bg-white hover:bg-gray-50 transition-colors h-14 items-center relative">
                      <div className="absolute" style={{ left: pos.left, width: pos.width }}>
                        <div
                          className={`h-8 rounded-md mx-1 flex items-center px-3 text-white text-xs font-semibold shadow-sm cursor-pointer hover:shadow-md transition-shadow overflow-hidden ${colorClass}`}
                          style={{
                            backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.15), rgba(255,255,255,0.15) 10px, transparent 10px, transparent 20px)',
                          }}
                          title={task.title}
                        >
                          <span className="truncate">{task.title}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCalendarView = () => {
    const currentMonth = new Date('2026-05-13');
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const getTasksForDay = (day: number | null) => {
      if (!day) return [];
      return tasks.filter(task => task.dueDate?.includes(day.toString().padStart(2, '0')));
    };

    const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">{monthName}</h2>

          {/* Week Days Header */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-sm font-semibold text-gray-600 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => {
              const dayTasks = getTasksForDay(day);
              const isToday = day === new Date('2026-05-13').getDate();

              return (
                <div
                  key={day ? `day-${day}` : `empty-${Math.random()}`}
                  className={`min-h-24 p-2 border rounded-lg ${
                    day === null
                      ? 'bg-gray-50 border-gray-100'
                      : isToday
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {day !== null && (
                    <>
                      <p className={`text-sm font-semibold mb-1 ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                        {day}
                      </p>
                      <div className="space-y-1">
                        {dayTasks.slice(0, 2).map((task) => (
                          <div
                            key={task.id}
                            className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 truncate"
                            title={task.title}
                          >
                            {task.id}
                          </div>
                        ))}
                        {dayTasks.length > 2 && (
                          <p className="text-xs text-gray-500 px-1.5">
                            +{dayTasks.length - 2} more
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-6 pt-6 border-t border-gray-200 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-400"></div>
              <span className="text-sm text-gray-600">Task Scheduled</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-400"></div>
              <span className="text-sm text-gray-600">Today</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDashboardView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-600 text-sm mb-2">Total Tasks</p>
        <p className="text-3xl font-bold text-gray-900">{tasks.length}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-600 text-sm mb-2">In Progress</p>
        <p className="text-3xl font-bold text-orange-600">{tasks.filter(t => t.status === 'In progress').length}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-600 text-sm mb-2">In Review</p>
        <p className="text-3xl font-bold text-green-600">{tasks.filter(t => t.status === 'In review').length}</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-600 text-sm mb-2">Backlog</p>
        <p className="text-3xl font-bold text-gray-600">{tasks.filter(t => t.status === 'Backlog').length}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {notifications.length > 0 && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-900">
            <p className="text-sm font-semibold mb-2">Shared with you</p>
            <div className="space-y-2">
              {notifications.slice(0, 3).map((notification) => (
                <div key={notification.id} className="text-sm text-emerald-800">
                  {notification.message}
                  <span className="ml-2 text-xs text-emerald-600">
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
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 text-sm font-medium"
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
                  ? 'bg-emerald-600 text-white'
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
                      className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold"
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
                      <option value="Backlog">Backlog</option>
                      <option value="In progress">In progress</option>
                      <option value="In review">In review</option>
                    </select>
                  </div>
                  <input
                    value={createTask.title}
                    onChange={(e) => setCreateTask((current) => ({ ...current, title: e.target.value }))}
                    placeholder="Task title"
                    className="w-full text-3xl font-bold text-gray-900 mb-3 border-b border-gray-200 focus:outline-none focus:border-emerald-500"
                  />
                  <textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="Add a detailed description..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
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
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-200'
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="time"
                      value={createDueTime}
                      onChange={(e) => setCreateDueTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={addCreateSubtask}
                      className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
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
                          className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
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
                  className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors"
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
