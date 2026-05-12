'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useGoogleAuth } from '@/app/ui/GoogleAuthProvider';
import { useRouter } from 'next/navigation';

type Message = {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
};

type Conversation = {
  id: string;
  title: string;
  model: 'GPT-4' | 'GPT-3.5' | 'Claude' | 'Gemini';
  messageCount: number;
  lastMessage: string;
  lastUpdated: string;
  createdDate: string;
  messages: Message[];
};

const QUICK_SUGGESTIONS = [
  'summarize my tasks',
  'create task called Submit visa docs due tomorrow',
  'show calendar summary for trip 3',
  'create itinerary event for trip 3 day 2 titled Hotel check-in',
];

export default function AIChatbotPage() {
  const router = useRouter();
  const { token: googleAccessToken } = useGoogleAuth();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<'All' | 'GPT-4' | 'GPT-3.5' | 'Claude' | 'Gemini'>('All');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pendingActionToken, setPendingActionToken] = useState<string | null>(null);
  const [pendingActionLabel, setPendingActionLabel] = useState<string | null>(null);
  const [pendingActionPreview, setPendingActionPreview] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch('/api/ai-chatbot', {
          method: 'GET',
          credentials: 'include',
        });

        if (res.status === 401) {
          router.push('/auth/login');
          return;
        }

        if (res.ok) {
          const data = (await res.json()) as { userId?: number };
          setAuthUserId(typeof data.userId === 'number' ? data.userId : null);
        }
      } catch {
        // Ignore network checks here; send path will handle failures.
      }
    };

    void verifyAuth();
  }, [router]);

  useEffect(() => {
    if (!authUserId) return;
    const storageKey = `la_erp_ai_chats_v1_${authUserId}`;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setConversations([]);
        setSelectedConversation(null);
        return;
      }

      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed)) {
        setConversations(parsed);
        setSelectedConversation(parsed[0] ?? null);
      }
    } catch {
      setConversations([]);
      setSelectedConversation(null);
    }
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId) return;
    const storageKey = `la_erp_ai_chats_v1_${authUserId}`;
    localStorage.setItem(storageKey, JSON.stringify(conversations));
  }, [authUserId, conversations]);

  const createNewConversation = () => {
    const now = new Date();
    const newConversation: Conversation = {
      id: `C-${Date.now()}`,
      title: `Chat ${conversations.length + 1}`,
      model: 'Gemini',
      messageCount: 0,
      lastMessage: 'New conversation',
      lastUpdated: 'Now',
      createdDate: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      messages: [],
    };

    setConversations((prev) => [newConversation, ...prev]);
    setSelectedConversation(newConversation);
    setShowNewChatModal(false);
  };

  const getModelColor = (model: string) => {
    switch (model) {
      case 'GPT-4':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'GPT-3.5':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Claude':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Gemini':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch = conv.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesModel = selectedModel === 'All' || conv.model === selectedModel;
    return matchesSearch && matchesModel;
  });

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConversation) return;

    const prompt = messageInput.trim();
    const conversationId = selectedConversation.id;

    const newUserMessage: Message = {
      id: `M-${Date.now()}`,
      sender: 'user',
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedConversations = conversations.map((conv) => {
      if (conv.id === selectedConversation.id) {
        return {
          ...conv,
          messages: [...conv.messages, newUserMessage],
          messageCount: conv.messageCount + 1,
          lastMessage: prompt,
          lastUpdated: 'Now',
        };
      }
      return conv;
    });

    setConversations(updatedConversations);
    const updated = updatedConversations.find((c) => c.id === conversationId);
    if (updated) setSelectedConversation(updated);

    setMessageInput('');
    setIsTyping(true);

    try {
      const history = selectedConversation.messages.map((message) => ({
        role: message.sender,
        text: message.text,
      }));

      const res = await fetch('/api/ai-chatbot', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          history,
          googleAccessToken,
        }),
      });

      let responseText = 'Sorry, I could not generate a response right now.';
      if (res.ok) {
        const data = (await res.json()) as {
          text?: string;
          pendingActionToken?: string;
          pendingActionLabel?: string;
          pendingActionPreview?: string | null;
        };
        responseText = (data.text || responseText).trim();
        setPendingActionToken(data.pendingActionToken ?? null);
        setPendingActionLabel(data.pendingActionLabel ?? null);
        setPendingActionPreview(data.pendingActionPreview ?? null);
      } else {
        if (res.status === 401) {
          responseText = 'Your session has expired. Redirecting to login...';
          setTimeout(() => router.push('/auth/login'), 800);
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error) {
            responseText = data.error;
          }
        }
      }

      const aiResponse: Message = {
        id: `M-${Date.now() + 1}`,
        sender: 'assistant',
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const finalConversations = updatedConversations.map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            messages: [...conv.messages, aiResponse],
            messageCount: conv.messageCount + 1,
            lastMessage: aiResponse.text,
            lastUpdated: 'Now',
          };
        }
        return conv;
      });

      setIsTyping(false);
      setConversations(finalConversations);
      const finalUpdated = finalConversations.find((c) => c.id === conversationId);
      if (finalUpdated) setSelectedConversation(finalUpdated);
    } catch {
      setIsTyping(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingActionToken || !selectedConversation) return;

    setIsTyping(true);
    try {
      const res = await fetch('/api/ai-chatbot', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmToken: pendingActionToken,
          googleAccessToken,
        }),
      });

      let responseText = 'Action failed.';
      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        responseText = data.text ?? responseText;
      } else {
        if (res.status === 401) {
          responseText = 'Your session has expired. Redirecting to login...';
          setTimeout(() => router.push('/auth/login'), 800);
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          responseText = data.error ?? responseText;
        }
      }

      const aiResponse: Message = {
        id: `M-${Date.now() + 2}`,
        sender: 'assistant',
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const nextConversations = conversations.map((conv) => {
        if (conv.id !== selectedConversation.id) return conv;
        return {
          ...conv,
          messages: [...conv.messages, aiResponse],
          messageCount: conv.messageCount + 1,
          lastMessage: aiResponse.text,
          lastUpdated: 'Now',
        };
      });

      setConversations(nextConversations);
      const nextSelected = nextConversations.find((conv) => conv.id === selectedConversation.id);
      if (nextSelected) {
        setSelectedConversation(nextSelected);
      }
    } finally {
      setPendingActionToken(null);
      setPendingActionLabel(null);
      setPendingActionPreview(null);
      setIsTyping(false);
    }
  };

  const handleCancelAction = () => {
    setPendingActionToken(null);
    setPendingActionLabel(null);
    setPendingActionPreview(null);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation?.messages, isTyping]);

  // Chat View
  if (selectedConversation) {
    return (
      <div className="flex flex-col h-screen bg-white">
        {/* Chat Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setSelectedConversation(null);
                setMessageInput('');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{selectedConversation.title}</h2>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getModelColor(selectedConversation.model)}`}>
            {selectedConversation.model}
          </span>
        </div>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
          {selectedConversation.messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-gray-500 text-sm">Start the conversation</p>
              </div>
            </div>
          ) : (
            selectedConversation.messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-3 rounded-lg whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-white text-gray-900 rounded-bl-none border border-gray-200'
                  }`}
                >
                  <p className="text-sm">{msg.text}</p>
                  <span className={`text-xs mt-2 block ${msg.sender === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            ))
          )}

          {/* AI Thinking Indicator */}
          {isTyping && (
            <div className="flex justify-start items-end gap-3">
              {/* Circular gradient orb */}
              <div className="relative shrink-0">
                <div
                  className="w-10 h-10 rounded-full animate-spin"
                  style={{
                    background: 'conic-gradient(from 0deg, #6366f1, #8b5cf6, #ec4899, #3b82f6, #06b6d4, #6366f1)',
                    animationDuration: '2s',
                  }}
                />
                <div className="absolute inset-0.75 rounded-full bg-gray-50" />
                <div
                  className="absolute inset-0.75 rounded-full animate-pulse"
                  style={{
                    background: 'radial-gradient(circle at 40% 40%, rgba(139,92,246,0.3), rgba(99,102,241,0.15))',
                  }}
                />
              </div>
              {/* Typing bubble */}
              <div className="bg-white border border-gray-200 rounded-lg rounded-bl-none px-4 py-3 shadow-sm">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">AI is thinking…</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setMessageInput(suggestion)}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
          {pendingActionToken && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">
                Confirm destructive action: {pendingActionLabel}
              </p>
              {pendingActionPreview && (
                <p className="mt-1 text-xs text-amber-800">{pendingActionPreview}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleConfirmAction}
                  className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Confirm
                </button>
                <button
                  onClick={handleCancelAction}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage();
                }
              }}
              placeholder="Type your message here..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              onClick={handleSendMessage}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.9429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.15159189 C3.34915502,0.9 2.40734225,1.00636533 1.77946707,1.4776575 C0.994623095,2.10604706 0.837654326,3.0486314 1.15159189,3.99701575 L3.03521743,10.4379088 C3.03521743,10.5950061 3.34915502,10.5950061 3.50612381,10.5950061 L16.6915026,11.3804931 C16.6915026,11.3804931 17.1624089,11.3804931 17.1624089,10.7520501 L17.1624089,2.71327044 C17.1624089,2.40389169 17.3193777,2.09451293 17.6333152,2.09451293 C17.9472528,2.09451293 18.1042216,2.40389169 18.1042216,2.71327044 L18.1042216,11.3804931 C18.1042216,11.3804931 18.1042216,12.4744748 17.1624089,12.4744748 Z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Conversation List View
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">AI Chatbot</h1>

          {/* Search and Action Bar */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button onClick={() => setShowNewChatModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm whitespace-nowrap">
              + New Chat
            </button>
          </div>

          {/* Model Filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {['All', 'GPT-4', 'GPT-3.5', 'Claude', 'Gemini'].map((model) => (
              <button
                key={model}
                onClick={() => setSelectedModel(model as 'All' | 'GPT-4' | 'GPT-3.5' | 'Claude' | 'Gemini')}
                className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
                  selectedModel === model ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {filteredConversations.length > 0 ? (
          <div className="space-y-3">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedConversation(conversation)}
                className="w-full p-4 bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all text-left group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1 group-hover:text-blue-600 transition-colors">
                      {conversation.title}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{conversation.lastMessage}</p>
                  </div>
                  <div className="shrink-0 ml-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getModelColor(conversation.model)}`}>
                      {conversation.model}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                      </svg>
                      {conversation.messageCount} messages
                    </span>
                    <span>Created {conversation.createdDate}</span>
                  </div>
                  <span className="text-xs font-medium text-gray-600">Updated {conversation.lastUpdated}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500 text-sm">No conversations found. Start a new chat to get started.</p>
          </div>
        )}
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <>
          {/* Blur Overlay */}
          <button
            type="button"
            onClick={() => setShowNewChatModal(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowNewChatModal(false);
              }
            }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
          />

          {/* Modal */}
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs bg-white rounded-lg shadow-2xl z-40 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Create New Chat</h2>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowNewChatModal(false)}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  createNewConversation();
                }}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
