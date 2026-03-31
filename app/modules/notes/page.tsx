'use client';

import React, { useState } from 'react';

type Note = {
  id: string;
  title: string;
  content: string;
  category: 'Personal' | 'Work' | 'Ideas';
  isPinned: boolean;
  createdDate: string;
  color: string;
};

export default function NotesPage() {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editedNote, setEditedNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Personal' | 'Work' | 'Ideas'>('All');
  const [notes, setNotes] = useState<Note[]>([
    { id: 'N-001', title: 'Project Kickoff Ideas', content: 'Initial thoughts for the new project', category: 'Work', isPinned: true, createdDate: 'May 15', color: 'bg-yellow-100 border-yellow-300' },
    { id: 'N-002', title: 'Meeting Notes - Q2 Planning', content: 'Discussed quarterly goals and milestones', category: 'Work', isPinned: true, createdDate: 'May 16', color: 'bg-blue-100 border-blue-300' },
    { id: 'N-003', title: 'Feature Brainstorm', content: 'New feature ideas for upcoming release', category: 'Ideas', isPinned: false, createdDate: 'May 17', color: 'bg-purple-100 border-purple-300' },
    { id: 'N-004', title: 'Personal Goals', content: 'Things to accomplish this month', category: 'Personal', isPinned: false, createdDate: 'May 18', color: 'bg-green-100 border-green-300' },
    { id: 'N-005', title: 'Quick Reminder', content: 'Follow up with the team', category: 'Work', isPinned: false, createdDate: 'May 19', color: 'bg-pink-100 border-pink-300' },
    { id: 'N-006', title: 'Design System Updates', content: 'New color palette and typography rules', category: 'Work', isPinned: true, createdDate: 'May 20', color: 'bg-indigo-100 border-indigo-300' },
    { id: 'N-007', title: 'Bug Report Summary', content: 'Critical issues found in testing', category: 'Work', isPinned: false, createdDate: 'May 21', color: 'bg-red-100 border-red-300' },
    { id: 'N-008', title: 'Random Idea', content: 'Could be useful later', category: 'Ideas', isPinned: false, createdDate: 'May 22', color: 'bg-orange-100 border-orange-300' },
    { id: 'N-009', title: 'Team Feedback', content: 'Collected insights from the team', category: 'Work', isPinned: false, createdDate: 'May 23', color: 'bg-cyan-100 border-cyan-300' },
    { id: 'N-010', title: 'Learning Resources', content: 'Useful articles and tutorials', category: 'Personal', isPinned: false, createdDate: 'May 24', color: 'bg-lime-100 border-lime-300' },
    { id: 'N-011', title: 'Client Requirements', content: 'Summary of client needs and expectations', category: 'Work', isPinned: false, createdDate: 'May 25', color: 'bg-sky-100 border-sky-300' },
    { id: 'N-012', title: 'Book Recommendations', content: 'Must read books recommended by colleagues', category: 'Personal', isPinned: false, createdDate: 'May 26', color: 'bg-fuchsia-100 border-fuchsia-300' },
  ]);

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const unpinnedNotes = notes.filter((n) => !n.isPinned);

  const filteredNotes = (noteList: Note[]) => {
    return noteList.filter((note) => {
      const matchesSearch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || note.content.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || note.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Notes</h1>

          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
            <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm">
              + New Note
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
            {['All', 'Personal', 'Work', 'Ideas'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat as 'All' | 'Personal' | 'Work' | 'Ideas')}
                className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
                  selectedCategory === cat ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Pinned Notes Section */}
        {filteredNotes(pinnedNotes).length > 0 && (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
              </svg>
              <h2 className="text-lg font-bold text-gray-900">Pinned Notes</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredNotes(pinnedNotes).map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => {
                    setSelectedNote(note);
                    setEditedNote({ ...note });
                  }}
                  className={`h-48 p-4 rounded-lg border-2 shadow-md hover:shadow-lg transition-all text-left flex flex-col ${note.color}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-bold text-gray-900 flex-1 line-clamp-2">{note.title}</h3>
                    <svg className="w-5 h-5 text-amber-600 shrink-0 ml-2" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                    </svg>
                  </div>
                  <p className="text-xs text-gray-700 flex-1 line-clamp-3 mb-3">{note.content}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-300/50">
                    <span className="text-xs font-medium text-gray-600">{note.category}</span>
                    <span className="text-xs text-gray-500">{note.createdDate}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* All Notes Section */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4">All Notes</h2>
          {filteredNotes(unpinnedNotes).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredNotes(unpinnedNotes).map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => {
                    setSelectedNote(note);
                    setEditedNote({ ...note });
                  }}
                  className={`h-48 p-4 rounded-lg border-2 shadow hover:shadow-lg transition-all text-left flex flex-col ${note.color}`}
                >
                  <h3 className="text-sm font-bold text-gray-900 line-clamp-2 mb-2">{note.title}</h3>
                  <p className="text-xs text-gray-700 flex-1 line-clamp-3 mb-3">{note.content}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-300/50">
                    <span className="text-xs font-medium text-gray-600">{note.category}</span>
                    <span className="text-xs text-gray-500">{note.createdDate}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 bg-white rounded-lg border border-gray-200">
              <p className="text-gray-500 text-sm">No notes found. Create a new note to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* Blur Overlay */}
      {selectedNote && (
        <button
          type="button"
          onClick={() => {
            setSelectedNote(null);
            setEditedNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSelectedNote(null);
              setEditedNote(null);
            }
          }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        />
      )}

      {/* Side Drawer */}
      {selectedNote && editedNote && (
        <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out">
          {/* Top Action Bar */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                editedNote.category === 'Work' ? 'bg-purple-100 text-purple-700' :
                editedNote.category === 'Personal' ? 'bg-green-100 text-green-700' :
                'bg-pink-100 text-pink-700'
              }`}>
                {editedNote.category}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditedNote({ ...editedNote, isPinned: !editedNote.isPinned })}
                className="p-2 text-gray-400 hover:text-amber-600"
              >
                <svg className={`w-5 h-5 ${editedNote.isPinned ? 'fill-amber-600 text-amber-600' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                </svg>
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  setSelectedNote(null);
                  setEditedNote(null);
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
            {/* Title */}
            <div className="mb-6">
              <input
                type="text"
                value={editedNote.title}
                onChange={(e) => setEditedNote({ ...editedNote, title: e.target.value })}
                className="text-3xl font-bold text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-2"
              />
            </div>

            {/* Metadata */}
            <div className="mb-6 pb-6 border-b border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Created</span>
                <span className="text-sm font-medium text-gray-900">{editedNote.createdDate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Category</span>
                <select
                  value={editedNote.category}
                  onChange={(e) => setEditedNote({ ...editedNote, category: e.target.value as 'Personal' | 'Work' | 'Ideas' })}
                  className="text-sm font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Personal">Personal</option>
                  <option value="Work">Work</option>
                  <option value="Ideas">Ideas</option>
                </select>
              </div>
            </div>

            {/* Content */}
            <div className="mb-6">
              <label htmlFor="note-content" className="block text-sm font-semibold text-gray-900 mb-3">
                Content
              </label>
              <textarea
                id="note-content"
                value={editedNote.content}
                onChange={(e) => setEditedNote({ ...editedNote, content: e.target.value })}
                placeholder="Write your notes here..."
                rows={12}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-sm font-normal"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
            <button
              onClick={() => {
                const updatedNotes = notes.map((n) => (n.id === editedNote.id ? editedNote : n));
                setNotes(updatedNotes);
                setSelectedNote(null);
                setEditedNote(null);
              }}
              className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors"
            >
              Save Note
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedNote(null);
                  setEditedNote(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setNotes(notes.filter((n) => n.id !== selectedNote.id));
                  setSelectedNote(null);
                  setEditedNote(null);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
