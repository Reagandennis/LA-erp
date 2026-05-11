'use client';

import { useState } from 'react';
import { 
  PersonStanding, Plane, Bed, Car, FileText, Music, SquareParking, Ship, Train, 
  CornerUpRight, Utensils, Sailboat, Ticket, Map, Flag, Users, Bus
} from 'lucide-react';

const PLAN_TYPES = [
  { type: 'Activity', icon: PersonStanding },
  { type: 'Flight', icon: Plane },
  { type: 'Lodging', icon: Bed },
  { type: 'Car Rental', icon: Car },
  { type: 'Note', icon: FileText },
  { type: 'Concert', icon: Music },
  { type: 'Parking', icon: SquareParking },
  { type: 'Cruise', icon: Ship },
  { type: 'Rail', icon: Train },
  { type: 'Primary Route', icon: CornerUpRight },
  { type: 'Restaurant', icon: Utensils },
  { type: 'Ferry', icon: Sailboat },
  { type: 'Theater', icon: Ticket },
  { type: 'Map', icon: Map },
  { type: 'Tour', icon: Flag },
  { type: 'Meeting', icon: Users },
  { type: 'Transportation', icon: Bus },
];

interface AddPlanPopoverProps {
  onSelect: (type: string) => void;
  trigger: React.ReactNode;
}

export default function AddPlanPopover({ onSelect, trigger }: AddPlanPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer inline-block">
        {trigger}
      </div>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right rounded-xl bg-white shadow-2xl ring-1 ring-black/5 p-4 border border-gray-100">
            <div className="grid grid-cols-2 gap-2">
              {PLAN_TYPES.map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => {
                    onSelect(type);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-blue-600 transition hover:bg-blue-600 hover:text-white group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white group-hover:bg-white group-hover:text-blue-600 transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  {type}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
