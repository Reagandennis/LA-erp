'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export default function CreateTripForm() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/trip-planning/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      if (res.ok) {
        const { trip } = await res.json();
        setIsOpen(false);
        setTitle('');
        router.push(`/modules/trip-planning/${trip.id}`);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || 'Failed to create trip');
      }
    } catch (error) {
      console.error('Failed to create trip', error);
      alert('Network error or server is unreachable');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" />
        New Trip
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Trip name..."
          className="rounded-xl border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
        <button
          type="submit"
          disabled={!title.trim() || isSubmitting}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? '...' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-xl px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
