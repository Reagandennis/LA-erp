'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// --- Types (mirror lib/communication.ts) ---
type CurrentUser = { id: number; name: string; email: string };

type Member = { id: number; name: string; email: string };

type Conversation = {
  id: number;
  type: string;
  title: string | null;
  members: Member[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  updatedAt: string;
};

type Message = {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
};

type MessageableUser = { id: number; name: string; email: string };

type Props = {
  currentUser: CurrentUser;
  initialConversations: Conversation[];
  initialUsers: MessageableUser[];
};

// --- Helpers ---
function getAvatarColor(name: string) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatListTime(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export default function CommunicationClient({ currentUser, initialConversations, initialUsers }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [users] = useState<MessageableUser[]>(initialUsers);
  const [activeConvId, setActiveConvId] = useState<number | null>(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConvIdRef = useRef<number | null>(activeConvId);
  activeConvIdRef.current = activeConvId;

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) ?? null,
    [conversations, activeConvId],
  );

  const conversationName = useCallback(
    (conv: Conversation) => {
      if (conv.title) return conv.title;
      const others = conv.members.filter((m) => m.id !== currentUser.id);
      if (others.length === 0) return 'You';
      return others.map((m) => m.name).join(', ');
    },
    [currentUser.id],
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // --- Load conversation list from server ---
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/communication/conversations', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { conversations?: Conversation[] };
      setConversations(data.conversations ?? []);
    } catch {
      // ignore
    }
  }, []);

  // --- Load messages for a conversation (also marks it read on the server) ---
  const loadMessages = useCallback(async (conversationId: number) => {
    try {
      const res = await fetch(`/api/communication/conversations/${conversationId}/messages`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: Message[] };
      if (activeConvIdRef.current === conversationId) {
        setMessages(data.messages ?? []);
      }
      // Clear the unread badge locally for the conversation we just read.
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
    } catch {
      // ignore
    }
  }, []);

  // Load messages whenever the active conversation changes.
  useEffect(() => {
    if (activeConvId == null) {
      setMessages([]);
      return;
    }
    void loadMessages(activeConvId);
  }, [activeConvId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- Live updates via Server-Sent Events ---
  useEffect(() => {
    const source = new EventSource('/api/communication/stream', { withCredentials: true });

    source.addEventListener('message', (event) => {
      let msg: Message;
      try {
        msg = JSON.parse((event as MessageEvent).data) as Message;
      } catch {
        return;
      }

      if (msg.conversationId === activeConvIdRef.current) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // We're looking at it — keep it marked read on the server.
        if (msg.senderId !== currentUser.id) {
          void fetch(`/api/communication/conversations/${msg.conversationId}/messages`, {
            credentials: 'include',
          });
        }
      }
      // Refresh the sidebar previews + unread counts.
      void loadConversations();
    });

    return () => {
      source.close();
    };
  }, [currentUser.id, loadConversations]);

  // --- Send a message ---
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageInput.trim();
    if (!text || activeConvId == null || sending) return;

    setSending(true);
    setMessageInput('');
    try {
      const res = await fetch(`/api/communication/conversations/${activeConvId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { message?: Message };
        if (data.message) {
          const sent = data.message;
          setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        }
        void loadConversations();
      } else {
        setMessageInput(text); // restore on failure
      }
    } catch {
      setMessageInput(text);
    } finally {
      setSending(false);
    }
  };

  // --- Start (or open) a direct conversation with a user ---
  const startConversation = async (userId: number) => {
    try {
      const res = await fetch('/api/communication/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { conversationId?: number };
      setIsNewChatOpen(false);
      setNewChatSearch('');
      await loadConversations();
      if (data.conversationId) {
        setActiveConvId(data.conversationId);
      }
    } catch {
      // ignore
    }
  };

  const filteredConversations = conversations.filter((conv) =>
    conversationName(conv).toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(newChatSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(newChatSearch.toLowerCase()),
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Left Pane - Conversation List */}
      <div className="w-80 lg:w-96 flex flex-col border-r border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Messages</h1>
            <button
              onClick={() => setIsNewChatOpen(true)}
              className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              aria-label="New conversation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>

          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 border-none rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              No conversations yet. Tap the pencil to start one.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const name = conversationName(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  className={`w-full p-4 flex items-center gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left ${
                    activeConvId === conv.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600' : ''
                  }`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${getAvatarColor(name)}`}>
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className={`text-sm font-semibold truncate ${activeConvId === conv.id ? 'text-emerald-900' : 'text-gray-900'}`}>
                        {name}
                      </h3>
                      <span className="text-[10px] text-gray-500 shrink-0 ml-2">{formatListTime(conv.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-500 truncate">{conv.lastMessage ?? 'No messages yet'}</p>
                      {conv.unreadCount > 0 && (
                        <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Center Pane - Chat Window */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {activeConv ? (
          <>
            {/* Chat Header */}
            <div className="h-[72px] px-6 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${getAvatarColor(conversationName(activeConv))}`}>
                  {initials(conversationName(activeConv))}
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 leading-tight">{conversationName(activeConv)}</h2>
                  <p className="text-xs text-emerald-600 font-medium">
                    {activeConv.type === 'direct'
                      ? activeConv.members.find((m) => m.id !== currentUser.id)?.email ?? 'Direct message'
                      : `${activeConv.members.length} members`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <button
                  onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                  className={`p-2 rounded-full transition-colors ${isDetailsOpen ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-gray-100'}`}
                  aria-label="Conversation details"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">
                  No messages yet. Say hello 👋
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.senderId === currentUser.id;
                  const showSender = activeConv.type === 'group' && !isMe;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex items-end gap-2 max-w-[80%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                        {!isMe && (
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${getAvatarColor(msg.senderName)}`}>
                            {initials(msg.senderName)}
                          </div>
                        )}
                        <div className="flex flex-col">
                          {showSender && <span className="text-[10px] font-semibold text-gray-500 mb-1 ml-1">{msg.senderName}</span>}
                          <div className={`px-4 py-2 rounded-2xl text-sm shadow-sm ${
                            isMe ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-white text-gray-900 border border-gray-100 rounded-bl-none'
                          }`}>
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                          </div>
                          <span className={`text-[10px] text-gray-400 mt-1 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>{formatTime(msg.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex items-end gap-2">
                <div className="flex-1 relative flex items-center bg-gray-100 rounded-2xl border border-transparent focus-within:border-emerald-500 focus-within:bg-white transition-all">
                  <textarea
                    rows={1}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendMessage(e);
                      }
                    }}
                    placeholder="Type a message..."
                    className="w-full py-3 px-4 bg-transparent border-none focus:ring-0 text-sm resize-none scrollbar-hide"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!messageInput.trim() || sending}
                  className={`p-3 rounded-2xl transition-all shadow-sm ${
                    messageInput.trim() && !sending ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  aria-label="Send message"
                >
                  <svg className="w-6 h-6 transform rotate-90" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-12 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Select a conversation</h3>
            <p className="max-w-xs">Choose a contact from the list, or start a new conversation.</p>
          </div>
        )}
      </div>

      {/* Right Pane - Details Drawer */}
      {isDetailsOpen && activeConv && (
        <div className="w-80 lg:w-96 border-l border-gray-200 bg-white animate-in slide-in-from-right duration-300">
          <div className="h-[72px] px-6 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Details</h2>
            <button
              onClick={() => setIsDetailsOpen(false)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"
              aria-label="Close details"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 overflow-y-auto h-[calc(100vh-72px)] custom-scrollbar">
            <div className="flex flex-col items-center text-center mb-8">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-lg ${getAvatarColor(conversationName(activeConv))}`}>
                {initials(conversationName(activeConv))}
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">{conversationName(activeConv)}</h3>
              <p className="text-sm text-gray-500">{activeConv.type === 'direct' ? 'Direct message' : 'Group chat'}</p>
            </div>

            <div>
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">
                Members ({activeConv.members.length})
              </h4>
              <div className="space-y-3">
                {activeConv.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${getAvatarColor(member.name)}`}>
                      {initials(member.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {member.name}{member.id === currentUser.id ? ' (You)' : ''}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">{member.email}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Conversation Modal */}
      {isNewChatOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[300] bg-black/30"
            onClick={() => setIsNewChatOpen(false)}
            aria-label="Close new conversation"
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[310] w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">New conversation</h2>
              <button
                onClick={() => setIsNewChatOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <input
                type="text"
                autoFocus
                placeholder="Search people..."
                value={newChatSearch}
                onChange={(e) => setNewChatSearch(e.target.value)}
                className="w-full px-4 py-2 bg-gray-100 border-none rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm mb-3"
              />
              <div className="max-h-72 overflow-y-auto space-y-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No users found.</p>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => startConversation(user.id)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold ${getAvatarColor(user.name)}`}>
                        {initials(user.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                        <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
