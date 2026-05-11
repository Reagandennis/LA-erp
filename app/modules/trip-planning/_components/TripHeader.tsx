'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { 
  Share2, Edit2, MoreHorizontal, Rocket, FileText, 
  X, Calendar, MapPin, Check, Loader2 
} from 'lucide-react';

interface TripHeaderProps {
  trip: any;
}

export default function TripHeader({ trip }: TripHeaderProps) {
  const router = useRouter();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tripStatus, setTripStatus] = useState(trip.status);

  // Edit form state
  const [editTitle, setEditTitle] = useState(trip.title);
  const [editDestination, setEditDestination] = useState(trip.destination || '');
  const [editStartDate, setEditStartDate] = useState(trip.startDate ? new Date(trip.startDate).toISOString().split('T')[0] : '');
  const [editEndDate, setEditEndDate] = useState(trip.endDate ? new Date(trip.endDate).toISOString().split('T')[0] : '');

  const handlePublish = async () => {
    if (tripStatus === 'published') return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/trip-planning/trips/${trip.id}/publish`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setTripStatus('published');
        setIsOptionsOpen(false);
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Failed to publish: ${data.error}`);
      }
    } catch (error) {
      alert('Failed to publish trip.');
    } finally {
      setPublishing(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/trip-planning/trips/${trip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          destination: editDestination,
          startDate: editStartDate,
          endDate: editEndDate,
        }),
      });
      if (res.ok) {
        setIsEditModalOpen(false);
        router.refresh();
      } else {
        alert('Failed to save changes.');
      }
    } catch (error) {
      alert('Error saving changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleSharePDF = () => {
    // For now, simulate PDF sharing by opening the print dialog
    window.print();
    setIsOptionsOpen(false);
  };

  return (
    <div className="relative mb-12">
      {/* Cover Image */}
      <div className="relative h-[400px] w-full overflow-hidden rounded-[2.5rem] shadow-2xl">
        <Image
          src={trip.imageUrl || 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=80'}
          alt={trip.title}
          fill
          className="object-cover brightness-75 transition-transform duration-700 hover:scale-105"
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        
        {/* Trip Content Overlay */}
        <div className="absolute bottom-0 left-0 w-full p-8 md:p-12">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-white/20 px-4 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white backdrop-blur-md">
                  Trip Planning
                </span>
                {tripStatus === 'published' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/30">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-200 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white"></span>
                    </span>
                    Live
                  </span>
                )}
              </div>
              <h1 className="text-5xl font-black text-white tracking-tighter md:text-6xl">{trip.title}</h1>
              <div className="flex flex-wrap items-center gap-6 text-white/80">
                <div className="flex items-center gap-2 font-bold">
                  <MapPin className="h-5 w-5 text-emerald-400" />
                  {trip.destination || 'Destination TBD'}
                </div>
                <div className="flex items-center gap-2 font-bold">
                  <Calendar className="h-5 w-5 text-emerald-400" />
                  {trip.startDate ? new Date(trip.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Dates TBD'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsEditModalOpen(true)}
                className="flex items-center gap-2 rounded-2xl bg-white px-6 py-3 text-sm font-black text-gray-900 transition-all hover:bg-gray-100 hover:scale-105 active:scale-95 shadow-xl"
              >
                <Edit2 className="h-4 w-4" />
                EDIT INFO
              </button>
              <div className="relative">
                <button 
                  onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur-md transition-all hover:bg-white/20 active:scale-90 border border-white/20"
                >
                  <MoreHorizontal className="h-6 w-6" />
                </button>

                {isOptionsOpen && (
                  <div className="absolute right-0 top-full mt-4 w-64 overflow-hidden rounded-3xl bg-white p-2 shadow-2xl ring-1 ring-black/5 z-50 animate-in fade-in zoom-in-95 duration-200">
                    <button 
                      onClick={handlePublish}
                      disabled={publishing || tripStatus === 'published'}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4 text-emerald-500" />}
                      {tripStatus === 'published' ? 'TRIP IS LIVE' : 'PUBLISH TRIP'}
                    </button>
                    <button 
                      onClick={handleSharePDF}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <FileText className="h-4 w-4 text-blue-500" />
                      SHARE AS PDF
                    </button>
                    <button 
                      onClick={() => { /* Manage Sharing Logic */ setIsOptionsOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Share2 className="h-4 w-4 text-purple-500" />
                      MANAGE ACCESS
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[100] p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-[2.5rem] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-8 py-6">
              <h3 className="text-xl font-black text-gray-900 uppercase tracking-tighter">Edit Trip Details</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Trip Title</label>
                <input 
                  type="text" 
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-3.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-600 focus:bg-white"
                  placeholder="e.g., Summer in Kenya"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Destination</label>
                <input 
                  type="text" 
                  value={editDestination}
                  onChange={(e) => setEditDestination(e.target.value)}
                  className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-3.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-600 focus:bg-white"
                  placeholder="e.g., Nairobi, Kenya"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Start Date</label>
                  <input 
                    type="date" 
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-3.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-600 focus:bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">End Date</label>
                  <input 
                    type="date" 
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-3.5 text-sm font-bold text-gray-900 outline-none transition-all focus:border-blue-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 rounded-2xl border-2 border-gray-100 px-6 py-4 text-sm font-black text-gray-500 hover:bg-gray-50 transition-all"
                >
                  CANCEL
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  {saving ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
