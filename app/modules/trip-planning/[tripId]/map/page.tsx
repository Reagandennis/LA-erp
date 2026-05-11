import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ArrowLeft, Edit2, MoreHorizontal, MapPin, ChevronDown, Share2, Printer } from 'lucide-react';
import dynamic from 'next/dynamic';

const MapClient = dynamic<{ startLocation: string; endLocation: string; travelMode?: string }>(
  () => import('@/app/modules/trip-planning/[tripId]/map/MapClient'),
  { 
    ssr: false,
    loading: () => <div className="h-[550px] w-full animate-pulse rounded-[2.5rem] bg-slate-50 border border-slate-100" />
  }
);

export default async function TripMapPage(
  { params, searchParams }: { params: Promise<{ tripId: string }>, searchParams: Promise<{ itemId?: string }> }
) {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseInt(rawTripId, 10);
  
  const { itemId: rawItemId } = await searchParams;
  const itemId = rawItemId ? parseInt(rawItemId, 10) : null;

  if (isNaN(tripId)) {
    redirect('/modules/trip-planning');
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: auth.user.id },
  }) as any;

  if (!trip) {
    redirect('/modules/trip-planning');
  }

  let item: any = null;
  if (itemId && !isNaN(itemId)) {
    item = await prisma.tripItineraryItem.findFirst({
      where: { id: itemId, tripId }
    }) as any;
  }

  const title = item?.title || 'Primary Route';
  const startLoc = item?.startLocation || '179 Runda Drive, Nairobi, Kenya';
  const endLoc = item?.endLocation || 'JKIA (NBO), Embakasi, Nairobi, Kenya';
  const travelMode = item?.notes?.match(/Mode: ([^|]*)/)?.[1] || 'Driving';
  const rawStartTime = item?.startTime ? new Date(item.startTime) : null;
  const formattedDate = rawStartTime ? rawStartTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBD';
  const formattedTime = rawStartTime ? rawStartTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time TBD';

  return (
    <main className="min-h-screen bg-white selection:bg-blue-100 selection:text-blue-900">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-12">
        
        {/* Navigation */}
        <Link
          href={`/modules/trip-planning/${tripId}`}
          className="mb-12 inline-flex items-center gap-3 text-xs font-black text-blue-600 uppercase tracking-[0.3em] hover:text-blue-800 transition-all group"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 group-hover:bg-blue-600 group-hover:text-white transition-all">
            <ArrowLeft className="h-4 w-4" />
          </div>
          Back to Trip Summary
        </Link>

        {/* Header */}
        <header className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between mb-16">
          <div className="space-y-2">
            <h1 className="text-6xl font-black text-gray-900 tracking-tightest leading-none">{title}</h1>
            <p className="text-xl font-bold text-gray-300 tracking-wider uppercase">Route Directions</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button className="flex items-center gap-3 rounded-2xl bg-slate-50 px-8 py-5 text-sm font-black text-blue-600 transition-all hover:bg-blue-600 hover:text-white shadow-sm border border-slate-100">
              <Edit2 className="h-4 w-4" />
              Edit Plan
            </button>
            <div className="relative group">
              <button className="flex items-center gap-3 rounded-2xl bg-slate-50 px-8 py-5 text-sm font-black text-blue-600 transition-all hover:bg-blue-600 hover:text-white shadow-sm border border-slate-100">
                <MoreHorizontal className="h-5 w-5" />
                Options
                <ChevronDown className="h-4 w-4 opacity-40" />
              </button>
              {/* Dropdown Menu (Simplified) */}
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-3xl shadow-2xl border border-slate-100 p-2 hidden group-hover:block z-50 animate-in fade-in slide-in-from-top-2">
                <button className="w-full flex items-center gap-3 px-6 py-4 text-xs font-black text-gray-600 hover:bg-slate-50 rounded-2xl transition-all uppercase tracking-widest">
                  <Share2 className="h-4 w-4" /> Share Link
                </button>
                <button className="w-full flex items-center gap-3 px-6 py-4 text-xs font-black text-gray-600 hover:bg-slate-50 rounded-2xl transition-all uppercase tracking-widest">
                  <Printer className="h-4 w-4" /> Export PDF
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Map Section */}
        <div className="mb-20">
          <div className="shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)] rounded-[3.5rem] overflow-hidden border-[12px] border-white bg-white ring-1 ring-slate-100">
            <MapClient startLocation={startLoc} endLocation={endLoc} travelMode={travelMode} />
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-24 items-start">
          
          {/* Left: Primary Details */}
          <div className="lg:col-span-5 space-y-16">
            <section>
              <div className="flex items-center gap-4 mb-10">
                <div className="h-1.5 w-12 bg-blue-600 rounded-full" />
                <h2 className="text-3xl font-black text-gray-900 uppercase tracking-tightest">Primary Details</h2>
              </div>
              
              <div className="space-y-12">
                <div className="bg-slate-50 p-10 rounded-[3rem] border border-slate-100 relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 text-slate-100 group-hover:text-blue-50 transition-colors">
                    <MapPin className="h-32 w-32" />
                  </div>
                  <div className="relative z-10">
                    <p className="text-xs font-black text-blue-400 uppercase tracking-[0.3em] mb-4">{formattedDate}</p>
                    <div className="flex items-baseline gap-3">
                      <p className="text-5xl font-black text-gray-900 tracking-tighter">{formattedTime.split(' ')[0]}</p>
                      <p className="text-lg font-black text-gray-400 uppercase tracking-widest">{formattedTime.split(' ')[1]}</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] ml-6">Directions Type</label>
                  <div className="relative">
                    <select 
                      defaultValue={travelMode}
                      className="w-full rounded-[2rem] border-2 border-slate-100 bg-slate-50 px-8 py-6 text-lg font-black text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all appearance-none cursor-pointer shadow-sm"
                    >
                      <option value="Driving">Driving Mode</option>
                      <option value="Walking">Walking Mode</option>
                      <option value="Transit">Transit Mode</option>
                    </select>
                    <div className="absolute right-8 top-1/2 -translate-y-1/2 h-8 w-8 bg-white rounded-full flex items-center justify-center border border-slate-100 pointer-events-none shadow-sm">
                      <ChevronDown className="h-4 w-4 text-blue-600" />
                    </div>
                  </div>
                </div>

                <button className="w-full flex items-center justify-center gap-4 rounded-[2rem] bg-blue-600 px-10 py-7 text-lg font-black text-white shadow-[0_25px_60px_-15px_rgba(37,99,235,0.4)] hover:bg-blue-700 hover:scale-[1.02] active:scale-95 transition-all">
                  <MapPin className="h-6 w-6" />
                  VIEW LIVE DIRECTIONS
                </button>
              </div>
            </section>
          </div>
          
          {/* Right: Addresses */}
          <div className="lg:col-span-7 space-y-12">
            <div className="space-y-6">
              <div className="flex items-center gap-4 ml-6">
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em]">From</p>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
              <div className="flex items-start gap-8 p-10 rounded-[3.5rem] border-2 border-blue-50 bg-blue-50/10 group cursor-pointer hover:bg-blue-50/20 hover:border-blue-200 transition-all shadow-sm">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.75rem] bg-blue-600 text-white shadow-2xl shadow-blue-600/40 group-hover:scale-110 transition-all duration-500">
                  <MapPin className="h-9 w-9" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2">Starting Address</h4>
                  <p className="text-2xl font-black text-blue-900 leading-tight tracking-tight">{startLoc}</p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-4 ml-6">
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em]">To</p>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
              <div className="flex items-start gap-8 p-10 rounded-[3.5rem] border-2 border-blue-50 bg-blue-50/10 group cursor-pointer hover:bg-blue-50/20 hover:border-blue-200 transition-all shadow-sm">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.75rem] bg-blue-600 text-white shadow-2xl shadow-blue-600/40 group-hover:scale-110 transition-all duration-500">
                  <MapPin className="h-9 w-9" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2">Destination Address</h4>
                  <p className="text-2xl font-black text-blue-900 leading-tight tracking-tight">{endLoc}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <footer className="mt-32 pt-12 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6 text-slate-400 font-bold text-xs uppercase tracking-widest">
           <div className="flex items-center gap-6">
              <p>© 2026 LA Trip Planner</p>
              <div className="h-1 w-1 bg-slate-200 rounded-full" />
              <p>Google Maps Data Integration</p>
           </div>
           <div className="flex items-center gap-4">
              <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              Real-time API Active
           </div>
        </footer>
      </div>
    </main>
  );
}
