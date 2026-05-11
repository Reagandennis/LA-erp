'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PersonStanding, Plane, Bed, Car, FileText, Music, SquareParking, Ship, Train, 
  CornerUpRight, Utensils, Sailboat, Ticket, Map, Flag, Users, Bus, Plus, MoreHorizontal,
  Trash2, GripVertical, ChevronDown, ChevronRight
} from 'lucide-react';
import AddPlanPopover from './AddPlanPopover';
import Link from 'next/link';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ICON_MAP: Record<string, React.ElementType> = {
  'Activity': PersonStanding,
  'Flight': Plane,
  'Lodging': Bed,
  'Car Rental': Car,
  'Note': FileText,
  'Concert': Music,
  'Parking': SquareParking,
  'Cruise': Ship,
  'Rail': Train,
  'Primary Route': CornerUpRight,
  'Restaurant': Utensils,
  'Ferry': Sailboat,
  'Theater': Ticket,
  'Map': Map,
  'Tour': Flag,
  'Meeting': Users,
  'Transportation': Bus,
};

type ItineraryItem = {
  id: number;
  dayNumber: number;
  title: string;
  itemType: string;
  location: string | null;
  startLocation: string | null;
  endLocation: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  sortOrder: number;
};

function SortableItem({ item, tripId, onEdit, onDelete, formatTime, getLabelForType }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const Icon = ICON_MAP[item.itemType] || FileText;
  const isFlight = item.itemType === 'Flight';
  const flightStatus = item.notes?.match(/Status: ([^|]*)/)?.[1] || 'Scheduled';

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-start group">
      <div className="hidden sm:block absolute left-0 top-1 w-20 text-right pr-6">
        <p className="text-sm font-black text-gray-900">{formatTime(item.startTime)}</p>
      </div>

      <div className="absolute left-6 sm:left-[6.25rem] top-0 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm ring-4 ring-white">
        <Icon className="h-5 w-5" />
      </div>

      <div className="ml-12 sm:ml-[8rem] w-full">
        <div className="flex items-start justify-between bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group-hover:border-blue-100 relative overflow-hidden">
          <div 
            {...attributes} 
            {...listeners} 
            className="absolute left-0 top-0 bottom-0 w-2 flex items-center justify-center bg-gray-50 hover:bg-blue-600 hover:text-white transition-colors cursor-grab active:cursor-grabbing text-gray-300"
          >
            <GripVertical className="h-4 w-4" />
          </div>
          
          <div className="space-y-1 flex-1 pl-4">
            <div className="flex items-center gap-3">
              {item.itemType === 'Primary Route' || item.itemType === 'Directions' || item.itemType === 'Map' ? (
                <Link href={`/modules/trip-planning/${tripId}/map?itemId=${item.id}`} className="text-lg font-bold text-blue-600 hover:underline">
                  {item.title}
                </Link>
              ) : (
                <h3 className="text-lg font-black text-gray-900">{item.title}</h3>
              )}
              {isFlight && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter ${flightStatus.includes('Delayed') ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                  {flightStatus}
                </span>
              )}
            </div>
            
            <div className="text-sm text-gray-600 mt-2 space-y-2">
              {isFlight ? (
                <>
                  <div className="flex items-center gap-6 bg-blue-50/50 p-3 rounded-xl border border-blue-100/50">
                    <div>
                      <p className="text-[10px] font-black text-blue-400 uppercase">Departure</p>
                      <p className="text-base font-black text-blue-900">{item.startLocation || 'TBD'}</p>
                      <p className="text-xs font-bold text-blue-600">{formatTime(item.startTime)}</p>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <div className="h-px bg-blue-200 w-full relative">
                        <Plane className="h-4 w-4 text-blue-400 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-blue-400 uppercase">Arrival</p>
                      <p className="text-base font-black text-blue-900">{item.endLocation || 'TBD'}</p>
                      <p className="text-xs font-bold text-blue-600">{formatTime(item.endTime)}</p>
                    </div>
                  </div>
                  {item.notes?.includes('Aircraft:') && (
                    <div className="flex gap-4 mt-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <p>Aircraft: <span className="text-gray-900">{item.notes.match(/Aircraft: ([^|]*)/)?.[1]}</span></p>
                      <p>Gate: <span className="text-gray-900">{item.notes.match(/Gate: ([^|]*)/)?.[1]}</span></p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {item.startLocation && (
                    <p><span className="font-semibold text-gray-400 text-xs uppercase tracking-wider">{getLabelForType(item.itemType, 'start')}:</span> {item.startLocation}</p>
                  )}
                  {item.endLocation && (
                    <p><span className="font-semibold text-gray-400 text-xs uppercase tracking-wider">{getLabelForType(item.itemType, 'end')}:</span> {item.endLocation}</p>
                  )}
                  {item.location && !item.startLocation && (
                    <p><span className="font-semibold text-gray-400 text-xs uppercase tracking-wider">{getLabelForType(item.itemType, 'loc')}:</span> {item.location}</p>
                  )}
                </>
              )}
              
              {item.notes && !isFlight && (
                <p className="italic text-gray-500 border-l-2 border-gray-200 pl-3 mt-2 text-xs">{item.notes}</p>
              )}
            </div>
          </div>
          
          <div className="ml-4 flex items-center gap-2">
            <button 
              onClick={() => onDelete(item.id)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-red-200 hover:bg-red-50 hover:text-red-600 transition-all shadow-sm"
              title="Delete Plan"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button 
              onClick={() => onEdit(item)}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
            >
              <MoreHorizontal className="h-4 w-4" />
              DETAILS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Timeline({ tripId, initialItems, status }: { tripId: number, initialItems: ItineraryItem[], status: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ItineraryItem[]>(initialItems);
  const [collapsedDays, setCollapsedDays] = useState<Record<number, boolean>>({});

  const toggleDayCollapse = (dayNumber: number) => {
    setCollapsedDays(prev => ({
      ...prev,
      [dayNumber]: !prev[dayNumber]
    }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Group items by dayNumber
  const itemsByDay = useMemo(() => {
    const grouped: Record<number, ItineraryItem[]> = {};
    items.forEach(item => {
      if (!grouped[item.dayNumber]) grouped[item.dayNumber] = [];
      grouped[item.dayNumber].push(item);
    });
    
    if (!grouped[1] && items.length === 0) grouped[1] = [];
    
    return grouped;
  }, [items]);

  const sortedDays = Object.keys(itemsByDay).map(Number).sort((a, b) => a - b);

  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((prevItems) => {
        const oldIndex = prevItems.findIndex((i) => i.id === active.id);
        const newIndex = prevItems.findIndex((i) => i.id === over.id);
        
        const newArray = arrayMove(prevItems, oldIndex, newIndex);
        
        // In a real app, we would send the new order to the backend here
        // For now, we update local state
        return newArray;
      });
    }
  };

  const handleDeleteDay = async (dayNumber: number) => {
    if (!confirm(`Are you sure you want to remove all items from Day ${dayNumber}?`)) return;

    try {
      // Find all items for this day
      const itemsToDelete = itemsByDay[dayNumber] || [];
      for (const item of itemsToDelete) {
        await fetch(`/api/trip-planning/trips/${tripId}/itinerary/${item.id}`, {
          method: 'DELETE',
        });
      }
      
      setItems(prev => prev.filter(i => i.dayNumber !== dayNumber));
      router.refresh();
    } catch (error) {
      console.error('Failed to delete day', error);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm('Are you sure you want to delete this plan?')) return;

    try {
      const res = await fetch(`/api/trip-planning/trips/${tripId}/itinerary/${itemId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== itemId));
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to delete item', error);
    }
  };

  const handleCreatePlan = async (dayNumber: number, type: string) => {
    try {
      const res = await fetch(`/api/trip-planning/trips/${tripId}/itinerary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayNumber,
          title: `New ${type}`,
          itemType: type,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        setItems(payload.items);
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to create item', error);
    }
  };

  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      const res = await fetch(`/api/trip-planning/trips/${tripId}/itinerary/${editingItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingItem),
      });
      if (res.ok) {
        const payload = await res.json();
        setItems(prev => prev.map(i => i.id === editingItem.id ? payload.item : i));
        setEditingItem(null);
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to update item', error);
    }
  };

  const handleAddNextDay = () => {
    const nextDay = sortedDays.length > 0 ? Math.max(...sortedDays) + 1 : 1;
    // We don't need to hit the API, just show the day in the list by adding a dummy or just letting groupedDays handle it
    // Actually, to make it persist, we should probably add a "Day Marker" or just allow adding an item to that day.
    // For now, I'll just scroll to the last day and let the user add an item.
    handleCreatePlan(nextDay, 'Note');
  };

  const [syncing, setSyncing] = useState(false);

  const syncFlightData = async () => {
    if (!editingItem || editingItem.itemType !== 'Flight') return;
    
    const flightNum = editingItem.title.toUpperCase();
    if (!flightNum) {
      alert('Please enter a flight number first (e.g., EK720)');
      return;
    }

    setSyncing(true);
    
    try {
      const res = await fetch(`/api/flight-radar?flightNum=${flightNum}&date=${editingItem.startTime || ''}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch flight data');
      }

      setEditingItem({
        ...editingItem,
        startLocation: data.start,
        endLocation: data.end,
        startTime: data.dep,
        endTime: data.arr,
        notes: `Status: ${data.status} | Aircraft: ${data.aircraft} | Gate: ${data.gate} | Real-time Data by FlightRadar24`
      });
    } catch (error: any) {
      console.error('Sync error:', error);
      alert(`Flight Sync Failed: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getLabelForType = (type: string, field: 'start' | 'end' | 'loc') => {
    if (field === 'start') {
      if (['Flight'].includes(type)) return 'Departure Airport';
      if (['Rail', 'Bus', 'Transportation', 'Ferry'].includes(type)) return 'Pickup / Station';
      if (['Primary Route', 'Directions', 'Map', 'Car Rental'].includes(type)) return 'Starting Address';
      return 'Start Location';
    }
    if (field === 'end') {
      if (['Flight'].includes(type)) return 'Arrival Airport';
      if (['Rail', 'Bus', 'Transportation', 'Ferry'].includes(type)) return 'Drop-off / Station';
      if (['Primary Route', 'Directions', 'Map', 'Car Rental'].includes(type)) return 'Destination Address';
      return 'End Location';
    }
    if (field === 'loc') {
      if (['Lodging'].includes(type)) return 'Hotel / Property Name';
      if (['Restaurant'].includes(type)) return 'Restaurant Name';
      if (['Activity', 'Tour', 'Meeting', 'Concert', 'Theater'].includes(type)) return 'Venue / Location';
      return 'Location';
    }
    return '';
  };

  const isTravelType = (type: string) => {
    return ['Flight', 'Rail', 'Ferry', 'Cruise', 'Transportation', 'Car Rental', 'Directions', 'Map', 'Primary Route'].includes(type);
  };

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-12 pb-24">
        {sortedDays.map(dayNumber => {
          const dayItems = itemsByDay[dayNumber];
          const isCollapsed = collapsedDays[dayNumber];
          
          return (
            <div key={dayNumber} className="relative">
              <div className="flex items-center justify-between bg-gray-50 px-6 py-4 rounded-2xl mb-8">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => toggleDayCollapse(dayNumber)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-400 shadow-sm transition-all hover:bg-gray-100 active:scale-95"
                  >
                    {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </button>
                  <div>
                    <h2 className="text-lg font-black text-gray-900 tracking-tight">Day {dayNumber}</h2>
                    {isCollapsed && dayItems.length > 0 && (
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{dayItems.length} {dayItems.length === 1 ? 'Plan' : 'Plans'}</p>
                    )}
                  </div>
                  <button 
                    onClick={() => handleDeleteDay(dayNumber)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-600 transition-all"
                    title="Remove Day"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <AddPlanPopover 
                  onSelect={(type) => handleCreatePlan(dayNumber, type)}
                  trigger={
                    <button className="flex items-center gap-2 rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-black text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm">
                      <Plus className="h-4 w-4" />
                      Add a Plan
                    </button>
                  }
                />
              </div>

              {!isCollapsed && (
                <div className="relative pl-6 sm:pl-24 animate-in slide-in-from-top-2 duration-300">
                  <div className="absolute top-0 bottom-0 left-[2.25rem] sm:left-[6.75rem] w-1 bg-blue-600/20 -z-10" />

                  {dayItems.length === 0 && (
                    <div className="py-12 text-center">
                      <p className="text-sm font-bold text-gray-400 italic">No plans added for this day yet.</p>
                    </div>
                  )}

                  <div className="space-y-10">
                    <SortableContext 
                      items={dayItems.map(i => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {dayItems.map(item => (
                        <SortableItem 
                          key={item.id} 
                          item={item} 
                          tripId={tripId}
                          onEdit={setEditingItem}
                          onDelete={handleDeleteItem}
                          formatTime={formatTime}
                          getLabelForType={getLabelForType}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </div>
              )}
            </div>
          );
        })}


        {/* Add Next Day Button */}
        <div className="flex justify-center pt-8">
          <button 
            onClick={handleAddNextDay}
            className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 px-10 py-6 text-base font-black text-gray-400 hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Plus className="h-6 w-6" />
            </div>
            Add Day {sortedDays.length + 1} to your itinerary
          </button>
        </div>

        {/* Edit Modal */}
        {editingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
              <form onSubmit={handleUpdateItem} className="flex flex-col h-full">
                <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                      {(() => {
                        const Icon = ICON_MAP[editingItem.itemType] || FileText;
                        return <Icon className="h-6 w-6" />;
                      })()}
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-gray-900 leading-tight">Edit {editingItem.itemType}</h2>
                      <p className="text-sm font-semibold text-gray-400">Day {editingItem.dayNumber} Itinerary</p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setEditingItem(null)}
                    className="h-10 w-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                  >
                    <Plus className="h-6 w-6 rotate-45" />
                  </button>
                </div>

                <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{editingItem.itemType === 'Flight' ? 'Flight Number' : 'Plan Title'}</label>
                      <input 
                        type="text" 
                        value={editingItem.title} 
                        onChange={e => setEditingItem({...editingItem, title: e.target.value})}
                        placeholder={editingItem.itemType === 'Flight' ? 'e.g., EK720' : `e.g., ${editingItem.itemType}`}
                        className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all placeholder:text-gray-300"
                      />
                    </div>
                    {editingItem.itemType === 'Flight' && (
                      <button 
                        type="button"
                        onClick={syncFlightData}
                        disabled={syncing}
                        className={`mb-1 rounded-2xl px-6 py-4 text-xs font-black transition-all shadow-sm flex items-center gap-2 ${syncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'}`}
                      >
                        <Plane className={`h-4 w-4 rotate-90 ${syncing ? 'animate-pulse' : ''}`} />
                        {syncing ? 'SEEKING...' : 'SYNC API'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Start Time</label>
                      <div className="relative">
                        <input 
                          type="datetime-local" 
                          value={editingItem.startTime ? new Date(new Date(editingItem.startTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} 
                          onChange={e => setEditingItem({...editingItem, startTime: e.target.value ? new Date(e.target.value).toISOString() : null})}
                          className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">End Time</label>
                      <div className="relative">
                        <input 
                          type="datetime-local" 
                          value={editingItem.endTime ? new Date(new Date(editingItem.endTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} 
                          onChange={e => setEditingItem({...editingItem, endTime: e.target.value ? new Date(e.target.value).toISOString() : null})}
                          className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {isTravelType(editingItem.itemType) ? (
                    <div className="space-y-6">
                      {editingItem.itemType === 'Primary Route' && (
                        <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Directions Type</label>
                          <select 
                            value={editingItem.notes?.match(/Mode: ([^|]*)/)?.[1] || 'Driving'} 
                            onChange={e => {
                              const currentNotes = editingItem.notes || '';
                              const newMode = e.target.value;
                              const updatedNotes = currentNotes.includes('Mode:') 
                                ? currentNotes.replace(/Mode: [^|]*/, `Mode: ${newMode}`)
                                : `${currentNotes} | Mode: ${newMode}`;
                              setEditingItem({...editingItem, notes: updatedNotes});
                            }}
                            className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all"
                          >
                            <option value="Driving">Driving</option>
                            <option value="Walking">Walking</option>
                            <option value="Transit">Transit</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{getLabelForType(editingItem.itemType, 'start')}</label>
                        <input 
                          type="text" 
                          value={editingItem.startLocation || ''} 
                          onChange={e => setEditingItem({...editingItem, startLocation: e.target.value})}
                          placeholder="Starting Address..."
                          className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all placeholder:text-gray-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{getLabelForType(editingItem.itemType, 'end')}</label>
                        <input 
                          type="text" 
                          value={editingItem.endLocation || ''} 
                          onChange={e => setEditingItem({...editingItem, endLocation: e.target.value})}
                          placeholder="Destination Address..."
                          className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all placeholder:text-gray-300"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{getLabelForType(editingItem.itemType, 'loc')}</label>
                      <input 
                        type="text" 
                        value={editingItem.location || ''} 
                        onChange={e => setEditingItem({...editingItem, location: e.target.value})}
                        placeholder="Property name, restaurant, or landmark..."
                        className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all placeholder:text-gray-300"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Additional Notes</label>
                    <textarea 
                      value={editingItem.notes || ''} 
                      onChange={e => setEditingItem({...editingItem, notes: e.target.value})}
                      placeholder="Add confirmation numbers, gate info, dress code, or specific reminders here..."
                      rows={4}
                      className="w-full rounded-2xl border-2 border-gray-100 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 focus:border-blue-600 focus:bg-white focus:outline-none transition-all placeholder:text-gray-300 resize-none"
                    />
                  </div>
                </div>

                <div className="px-8 py-6 bg-white border-t border-gray-100 flex items-center justify-between sticky bottom-0 z-10">
                  <button 
                    type="button" 
                    onClick={() => setEditingItem(null)}
                    className="text-sm font-black text-gray-400 hover:text-gray-600 transition tracking-widest uppercase"
                  >
                    Discard Changes
                  </button>
                  <button 
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-8 py-4 text-base font-black text-white hover:bg-blue-700 transition shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
                  >
                    Update Plan
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}
