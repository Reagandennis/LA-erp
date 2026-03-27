'use client';

import React, { useState } from 'react';

const PRIORITY_COLORS = {
  High: 'bg-red-100 text-red-800',
  Medium: 'bg-yellow-100 text-yellow-800',
  Low: 'bg-emerald-100 text-emerald-800',
};

const STATUS_COLORS = {
  Backlog: 'bg-gray-50',
  'In progress': 'bg-orange-50',
  'In review': 'bg-green-50',
};

type ViewType = 'list' | 'kanban' | 'gantt' | 'calendar' | 'dashboard';

type Task = {
  id: string;
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  list: string;
  dueDate: string | null;
  status: string;
  assignees: number;
};

export default function TodoPersonalPage() {
  const [activeView, setActiveView] = useState<ViewType>('kanban');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [tasks, setTasks] = useState<Task[]>([
    { id: 'KY-473', title: 'Define User Personas', priority: 'High', list: 'USER', dueDate: 'Mon, 15 May 2026', status: 'Backlog', assignees: 5 },
    { id: 'AB-156', title: 'Evaluate Market Trends', priority: 'Medium', list: 'Research', dueDate: 'Tue, 16 May 2026', status: 'Backlog', assignees: 4 },
    { id: 'OR-020', title: 'Gather User Feedback', priority: 'Low', list: 'USER', dueDate: 'Wed, 17 May 2026', status: 'Backlog', assignees: 3 },
    { id: 'LM-204', title: 'Optimize Content Strategy', priority: 'Low', list: 'Marketing', dueDate: null, status: 'Backlog', assignees: 2 },
    { id: 'ST-858', title: 'Assess User Engagement', priority: 'Low', list: 'USER', dueDate: null, status: 'Backlog', assignees: 3 },
    
    { id: 'OH-312', title: 'Map User Journeys', priority: 'High', list: 'USER', dueDate: 'Thu, 18 May 2026', status: 'In progress', assignees: 4 },
    { id: 'EF-928', title: 'Analyze Traffic Sources', priority: 'Medium', list: 'Marketing', dueDate: null, status: 'In progress', assignees: 2 },
    { id: 'YZ-466', title: 'Implement Analytics Tools', priority: 'Medium', list: 'Marketing', dueDate: null, status: 'In progress', assignees: 3 },
    { id: 'CD-587', title: 'Conduct Usability Testing', priority: 'Low', list: 'USER', dueDate: 'Fri, 19 May 2026', status: 'In progress', assignees: 4 },
    { id: 'WK-123', title: 'Refine User Interface', priority: 'Low', list: 'UI Design', dueDate: 'Sun, 21 May 2026', status: 'In progress', assignees: 3 },
    { id: 'OP-789', title: 'Launch Beta Testing', priority: 'Low', list: 'Beta Testing', dueDate: 'Mon, 22 May 2026', status: 'In progress', assignees: 2 },
    
    { id: 'JK-341', title: 'Create Wireframes', priority: 'High', list: 'UI Design', dueDate: 'Sat, 20 May 2026', status: 'In review', assignees: 4 },
    { id: 'UV-678', title: 'Run A/B Testing', priority: 'High', list: 'Beta Testing', dueDate: 'Tue, 23 May 2026', status: 'In review', assignees: 3 },
    { id: 'MJ-045', title: 'Develop Feature Roadmap', priority: 'Low', list: 'Big Picture', dueDate: 'Wed, 24 May 2026', status: 'In review', assignees: 2 },
  ]);

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
            <div className={`p-4 space-y-3 min-h-96 overflow-y-auto ${STATUS_COLORS[status as keyof typeof STATUS_COLORS]}`}>
              {statusTasks.length > 0 ? (
                statusTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-white p-4 rounded-lg border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
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
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-400">
                  <p className="text-sm">No tasks</p>
                </div>
              )}
            </div>
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
                setSelectedTask(task);
                setEditedTask({ ...task });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setSelectedTask(task);
                  setEditedTask({ ...task });
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

      {/* Edit Modal */}
      {selectedTask && editedTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Edit Task</h2>
              
              <form className="space-y-4">
                {/* Task ID (read-only) */}
                <div>
                  <label htmlFor="task-id" className="block text-sm font-medium text-gray-700 mb-1">Task ID</label>
                  <input
                    id="task-id"
                    type="text"
                    value={editedTask.id}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                  />
                </div>

                {/* Title */}
                <div>
                  <label htmlFor="task-title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    id="task-title"
                    type="text"
                    value={editedTask.title}
                    onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="task-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    id="task-priority"
                    value={editedTask.priority}
                    onChange={(e) => setEditedTask({ ...editedTask, priority: e.target.value as 'High' | 'Medium' | 'Low' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                {/* List */}
                <div>
                  <label htmlFor="task-list" className="block text-sm font-medium text-gray-700 mb-1">List</label>
                  <input
                    id="task-list"
                    type="text"
                    value={editedTask.list}
                    onChange={(e) => setEditedTask({ ...editedTask, list: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Status */}
                <div>
                  <label htmlFor="task-status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    id="task-status"
                    value={editedTask.status}
                    onChange={(e) => setEditedTask({ ...editedTask, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Backlog">Backlog</option>
                    <option value="In progress">In progress</option>
                    <option value="In review">In review</option>
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label htmlFor="task-duedate" className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    id="task-duedate"
                    type="text"
                    value={editedTask.dueDate || ''}
                    onChange={(e) => setEditedTask({ ...editedTask, dueDate: e.target.value || null })}
                    placeholder="e.g., Mon, 15 May 2026"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </form>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    const updatedTasks = tasks.map(t => t.id === editedTask.id ? editedTask : t);
                    setTasks(updatedTasks);
                    setSelectedTask(null);
                    setEditedTask(null);
                  }}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setSelectedTask(null);
                    setEditedTask(null);
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
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderGanttView = () => {
    const sortedTasks = [...tasks].sort((a, b) => {
      if (!a.dueDate || !b.dueDate) return 0;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    const today = new Date('2026-05-13');
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 5);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);

    const getTaskPosition = (dueDate: string | null) => {
      if (!dueDate) return { start: 0, width: 0 };
      const taskDate = new Date(dueDate.replace(/(\w+),\s+(\d+)\s+(\w+)\s+(\d+)/, '$3 $2, $4'));
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const dayOffset = Math.ceil((taskDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      return {
        start: (dayOffset / totalDays) * 100,
        width: Math.max(5, (5 / totalDays) * 100),
      };
    };

    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Project Timeline</h2>
          
          {/* Timeline Header */}
          <div className="mb-6">
            <div className="h-8 bg-gray-100 rounded flex items-center px-4 text-xs font-semibold text-gray-600 gap-2">
              <span className="w-40">Task</span>
              <div className="flex-1 flex gap-2">
                {Array.from({ length: 8 }).map((_, i) => {
                  const date = new Date(startDate);
                  date.setDate(date.getDate() + i * 5);
                  return (
                    <div key={date.toISOString()} className="flex-1 text-center text-xs">
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tasks Timeline */}
          <div className="space-y-4">
            {sortedTasks.map((task) => {
              const position = getTaskPosition(task.dueDate);
              const statusColor = 
                task.status === 'Backlog' ? 'bg-gray-400' : 
                task.status === 'In progress' ? 'bg-orange-500' : 
                'bg-green-500';

              return (
                <div key={task.id} className="flex items-center gap-4">
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{task.id}</p>
                    <p className="text-xs text-gray-600 truncate">{task.title.substring(0, 20)}...</p>
                  </div>
                  <div className="flex-1 h-8 bg-gray-50 rounded relative border border-gray-200">
                    <div
                      className={`absolute h-full rounded flex items-center px-2 text-xs font-semibold text-white transition-all ${statusColor}`}
                      style={{
                        left: `${position.start}%`,
                        width: `${position.width}%`,
                        minWidth: '60px',
                      }}
                    >
                      {position.width > 8 && task.priority}
                    </div>
                  </div>
                  <div className="w-24 shrink-0">
                    <p className="text-xs text-gray-600">{task.dueDate || 'No date'}</p>
                  </div>
                </div>
              );
            })}
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
      </div>
    </div>
  );
}
