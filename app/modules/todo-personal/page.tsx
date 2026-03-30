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
  const [subtasks, setSubtasks] = useState<Array<{ id: string; title: string; completed: boolean }>>([]);
  const [notes, setNotes] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
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
              setNotes('');
              setDescription('');
              setDueTime('');
            }}
            aria-label="Close task drawer"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSelectedTask(null);
                setEditedTask(null);
                setSubtasks([]);
                setNotes('');
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
                  <p className="text-sm font-semibold text-gray-900">Attachments (2)</p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
                    <div className="w-10 h-10 bg-indigo-500 rounded flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">Quality-Testing-Task.pdf</p>
                      <p className="text-xs text-gray-500">12.40 MB • Preview</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
                    <div className="w-10 h-10 bg-blue-500 rounded flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">test-cases.xlsx</p>
                      <p className="text-xs text-gray-500">2.34 MB • Preview</p>
                    </div>
                  </div>
                </div>
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
                  <p className="text-sm font-semibold text-gray-900">Comment (2)</p>
                  <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">See All</button>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gray-300 shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Olivier Giroud</p>
                        <p className="text-xs text-gray-500">11 minute ago</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 ml-11">This task is crucial for ensuring the successful deployment of the new software version. It is essential to conduct thorough testing to identify and address any issues before the release.</p>
                    <div className="flex gap-4 ml-11 mt-2">
                      <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">Reply Comment</button>
                      <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">Link Comment</button>
                    </div>
                  </div>
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
                          setSubtasks(subtasks.map(st => 
                            st.id === subtask.id ? { ...st, completed: !st.completed } : st
                          ));
                        }}
                        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <div className="flex-1">
                        <p className={`text-sm ${subtask.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {subtask.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Evaluate the software's speed, responsiveness, and resource usage</p>
                      </div>
                      <button
                        onClick={() => setSubtasks(subtasks.filter(st => st.id !== subtask.id))}
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

              {/* Notes/Description */}
              <div className="mb-6">
                <label htmlFor="drawer-notes" className="block text-sm font-semibold text-gray-900 mb-3">Notes</label>
                <textarea
                  id="drawer-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
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
                  setNotes('');
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
                    setNotes('');
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
                    setNotes('');
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
