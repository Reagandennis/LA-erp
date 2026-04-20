'use client';

import React, { useState, useRef, useEffect } from 'react';

// --- Types ---
type UserStatus = 'online' | 'offline' | 'away' | 'busy';

interface User {
  id: string;
  name: string;
  avatar: string;
  status: UserStatus;
  role?: string;
}

interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'file' | 'pdf';
  url: string;
  size?: string;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  attachments?: Attachment[];
  isRead?: boolean;
}

interface Conversation {
  id: string;
  name: string;
  type: 'direct' | 'group';
  avatar?: string;
  members: string[]; // User IDs
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  isOnline?: boolean;
}

// --- Mock Data ---
const MOCK_USERS: Record<string, User> = {
  'user-1': { id: 'user-1', name: 'John Doe', avatar: 'JD', status: 'online', role: 'Project Manager' },
  'user-2': { id: 'user-2', name: 'Sarah Smith', avatar: 'SS', status: 'away', role: 'UI Designer' },
  'user-3': { id: 'user-3', name: 'Mike Ross', avatar: 'MR', status: 'offline', role: 'Backend Developer' },
  'user-4': { id: 'user-4', name: 'Emily Blunt', avatar: 'EB', status: 'online', role: 'Frontend Developer' },
  'me': { id: 'me', name: 'Me', avatar: 'ME', status: 'online' },
};

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-1',
    name: 'Sarah Smith',
    type: 'direct',
    avatar: 'SS',
    members: ['me', 'user-2'],
    lastMessage: 'Sure, I will send the designs by EOD.',
    lastMessageTime: '10:45 AM',
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: 'conv-2',
    name: 'Project Alpha Team',
    type: 'group',
    members: ['me', 'user-1', 'user-2', 'user-4'],
    lastMessage: 'Emily: The API is ready for testing.',
    lastMessageTime: 'Yesterday',
    unreadCount: 0,
  },
  {
    id: 'conv-3',
    name: 'Mike Ross',
    type: 'direct',
    avatar: 'MR',
    members: ['me', 'user-3'],
    lastMessage: 'Thanks for the help!',
    lastMessageTime: 'Mon',
    unreadCount: 0,
    isOnline: false,
  },
  {
    id: 'conv-4',
    name: 'Design Sync',
    type: 'group',
    members: ['me', 'user-2', 'user-4'],
    lastMessage: 'Sarah: Updated the color palette.',
    lastMessageTime: 'Fri',
    unreadCount: 5,
  },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
  'conv-1': [
    { id: 'm1', senderId: 'user-2', text: 'Hi! Have you seen the new project brief?', timestamp: '10:30 AM' },
    { id: 'm2', senderId: 'me', text: 'Not yet, let me check.', timestamp: '10:32 AM' },
    { id: 'm3', senderId: 'user-2', text: 'I attached the PDF here for quick access.', timestamp: '10:35 AM', attachments: [
      { id: 'a1', name: 'Project_Brief_V2.pdf', type: 'pdf', url: '#', size: '2.4 MB' }
    ]},
    { id: 'm4', senderId: 'user-2', text: 'Sure, I will send the designs by EOD.', timestamp: '10:45 AM' },
  ],
  'conv-2': [
    { id: 'm5', senderId: 'user-1', text: 'Morning team! Any updates on the sprint?', timestamp: '9:00 AM' },
    { id: 'm6', senderId: 'user-4', text: 'The API is ready for testing.', timestamp: '9:15 AM' },
  ]
};

export default function CommunicationPage() {
  const [activeConvId, setActiveConvId] = useState<string>('conv-1');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'direct' | 'group'>('all');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<Record<string, Message[]>>(MOCK_MESSAGES);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = MOCK_CONVERSATIONS.find(c => c.id === activeConvId);
  const currentMessages = messages[activeConvId] || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeConvId, messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'me',
      text: messageInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => ({
      ...prev,
      [activeConvId]: [...(prev[activeConvId] || []), newMessage]
    }));
    setMessageInput('');
  };

  const filteredConversations = MOCK_CONVERSATIONS.filter(conv => {
    const matchesSearch = conv.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || conv.type === filter;
    return matchesSearch && matchesFilter;
  });

  const getAvatarColor = (name: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Left Pane - Conversation List */}
      <div className="w-80 lg:w-96 flex flex-col border-r border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Messages</h1>
            <button className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          
          <div className="relative mb-4">
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

          <div className="flex p-1 bg-gray-100 rounded-lg">
            {(['all', 'direct', 'group'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all capitalize ${
                  filter === f ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConvId(conv.id)}
              className={`w-full p-4 flex items-center gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left ${
                activeConvId === conv.id ? 'bg-emerald-50 border-l-4 border-l-emerald-600' : ''
              }`}
            >
              <div className="relative">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${getAvatarColor(conv.name)}`}>
                  {conv.avatar || conv.name.substring(0, 2).toUpperCase()}
                </div>
                {conv.type === 'direct' && (
                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${conv.isOnline ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className={`text-sm font-semibold truncate ${activeConvId === conv.id ? 'text-emerald-900' : 'text-gray-900'}`}>
                    {conv.name}
                  </h3>
                  <span className="text-[10px] text-gray-500">{conv.lastMessageTime}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 truncate">{conv.lastMessage}</p>
                  {(conv.unreadCount ?? 0) > 0 && (
                    <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center Pane - Chat Window */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {activeConv ? (
          <>
            {/* Chat Header */}
            <div className="h-[72px] px-6 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${getAvatarColor(activeConv.name)}`}>
                  {activeConv.avatar || activeConv.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 leading-tight">{activeConv.name}</h2>
                  <p className="text-xs text-emerald-600 font-medium">
                    {activeConv.type === 'direct' ? (activeConv.isOnline ? 'Online' : 'Offline') : `${activeConv.members.length} members`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
                <button 
                  onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                  className={`p-2 rounded-full transition-colors ${isDetailsOpen ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-gray-100'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
              {currentMessages.map((msg) => {
                const isMe = msg.senderId === 'me';
                const sender = MOCK_USERS[msg.senderId];
                const showSender = activeConv.type === 'group' && !isMe;
                
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[80%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      {!isMe && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${getAvatarColor(sender?.name || '??')}`}>
                          {sender?.avatar || '??'}
                        </div>
                      )}
                      <div className="flex flex-col">
                        {showSender && <span className="text-[10px] font-semibold text-gray-500 mb-1 ml-1">{sender?.name}</span>}
                        <div className={`px-4 py-2 rounded-2xl text-sm shadow-sm ${
                          isMe ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-white text-gray-900 border border-gray-100 rounded-bl-none'
                        }`}>
                          <p>{msg.text}</p>
                          
                          {msg.attachments?.map((att) => (
                            <div key={att.id} className={`mt-2 p-2 rounded-lg flex items-center gap-3 ${isMe ? 'bg-emerald-700/50' : 'bg-gray-100'}`}>
                              <div className={`w-10 h-10 rounded flex items-center justify-center ${att.type === 'pdf' ? 'bg-red-500' : 'bg-blue-500'}`}>
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{att.name}</p>
                                <p className="text-[10px] opacity-70">{att.size}</p>
                              </div>
                              <button className="p-1 hover:bg-black/10 rounded">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        <span className={`text-[10px] text-gray-400 mt-1 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>{msg.timestamp}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex items-end gap-2">
                <div className="flex-1 relative flex items-center bg-gray-100 rounded-2xl border border-transparent focus-within:border-emerald-500 focus-within:bg-white transition-all">
                  <button type="button" className="p-3 text-gray-400 hover:text-emerald-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <textarea
                    rows={1}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                    placeholder="Type a message..."
                    className="w-full py-3 bg-transparent border-none focus:ring-0 text-sm resize-none scrollbar-hide"
                  />
                  <button type="button" className="p-3 text-gray-400 hover:text-emerald-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className={`p-3 rounded-2xl transition-all shadow-sm ${
                    messageInput.trim() ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
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
            <p className="max-w-xs">Choose a contact or group from the list to start messaging.</p>
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
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="p-6 overflow-y-auto h-[calc(100vh-72px)] custom-scrollbar">
            <div className="flex flex-col items-center text-center mb-8">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-lg ${getAvatarColor(activeConv.name)}`}>
                {activeConv.avatar || activeConv.name.substring(0, 2).toUpperCase()}
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">{activeConv.name}</h3>
              <p className="text-sm text-gray-500">
                {activeConv.type === 'direct' ? MOCK_USERS[activeConv.members.find(id => id !== 'me')!]?.role : 'Group Chat'}
              </p>
            </div>

            <div className="space-y-6">
              {/* Members/About */}
              <div>
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">
                  {activeConv.type === 'direct' ? 'About' : `Members (${activeConv.members.length})`}
                </h4>
                {activeConv.type === 'direct' ? (
                  <p className="text-sm text-gray-600">
                    Lead UI Designer with over 8 years of experience in creating modern user interfaces.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activeConv.members.map(memberId => {
                      const user = MOCK_USERS[memberId];
                      return (
                        <div key={memberId} className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${getAvatarColor(user?.name || '??')}`}>
                            {user?.avatar || '??'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
                            <p className="text-[10px] text-gray-500 truncate">{user?.role || 'Member'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Shared Files */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Shared Files</h4>
                  <button className="text-xs font-bold text-emerald-600 hover:text-emerald-700">See All</button>
                </div>
                <div className="space-y-3">
                  {[
                    { name: 'Branding_Guide.pdf', size: '4.2 MB', type: 'pdf' },
                    { name: 'Wireframes_v1.zip', size: '12.8 MB', type: 'file' },
                    { name: 'Logo_Final.png', size: '1.1 MB', type: 'image' }
                  ].map((file, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer group">
                      <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center group-hover:bg-white transition-colors">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                        <p className="text-[10px] text-gray-500">{file.size}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settings */}
              <div className="pt-6 border-t border-gray-100 space-y-2">
                <button className="w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  Mute Notifications
                </button>
                <button className="w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Block User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
