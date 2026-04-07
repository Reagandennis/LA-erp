'use client';

import React, { useState } from 'react';

// --- Types ---
type VehicleStatus = 'Available' | 'In Use' | 'Maintenance' | 'Out of Service';
type VehicleType = 'Sedan' | 'SUV' | 'Truck' | 'Van' | 'Electric';
type MaintenanceType = 'Scheduled' | 'Unscheduled' | 'Emergency';
type MaintenancePriority = 'Low' | 'Medium' | 'High' | 'Critical';

interface MaintenanceLog {
  id: string;
  type: MaintenanceType;
  priority: MaintenancePriority;
  description: string;
  date: string;
  status: 'Reported' | 'In Progress' | 'Resolved';
  technician?: string;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin: string;
  type: VehicleType;
  status: VehicleStatus;
  mileage: string;
  fuelLevel: number;
  assignedTo?: string;
  lastService: string;
  nextService: string;
  image?: string;
  maintenanceHistory: MaintenanceLog[];
  insurance: {
    provider: string;
    policyNumber: string;
    expiryDate: string;
    status: 'Valid' | 'Expiring Soon' | 'Expired';
  };
}

// --- Mock Data ---
const MOCK_VEHICLES: Vehicle[] = [
  {
    id: 'VEH-001',
    make: 'Ford',
    model: 'F-150',
    year: 2023,
    plateNumber: 'ABC-1234',
    vin: '1FTFX1EF5PKE00001',
    type: 'Truck',
    status: 'In Use',
    mileage: '12,450 mi',
    fuelLevel: 65,
    assignedTo: 'Michael Ross',
    lastService: 'Jan 15, 2026',
    nextService: 'Jul 15, 2026',
    maintenanceHistory: [
      { id: 'M-101', type: 'Unscheduled', priority: 'High', description: 'Brake squeaking reported by operator.', date: 'Mar 25, 2026', status: 'In Progress' },
      { id: 'M-102', type: 'Scheduled', priority: 'Low', description: 'Oil change and tire rotation.', date: 'Jan 15, 2026', status: 'Resolved' }
    ],
    insurance: {
      provider: 'State Farm',
      policyNumber: 'SF-99001122',
      expiryDate: 'Dec 15, 2026',
      status: 'Valid'
    }
  },
  {
    id: 'VEH-002',
    make: 'Tesla',
    model: 'Model Y',
    year: 2024,
    plateNumber: 'EV-9988',
    vin: '5YJ3E1EB5LF000002',
    type: 'Electric',
    status: 'Available',
    mileage: '3,200 mi',
    fuelLevel: 92,
    lastService: 'Mar 01, 2026',
    nextService: 'Sep 01, 2026',
    maintenanceHistory: [],
    insurance: {
      provider: 'Geico Fleet',
      policyNumber: 'GCO-882233',
      expiryDate: 'May 20, 2026',
      status: 'Expiring Soon'
    }
  },
  {
    id: 'VEH-003',
    make: 'Mercedes-Benz',
    model: 'Sprinter',
    year: 2022,
    plateNumber: 'VAN-4422',
    vin: 'WD3PF4CD5KP000003',
    type: 'Van',
    status: 'Maintenance',
    mileage: '45,800 mi',
    fuelLevel: 20,
    lastService: 'Mar 28, 2026',
    nextService: 'Apr 05, 2026',
    maintenanceHistory: [
      { id: 'M-103', type: 'Unscheduled', priority: 'Critical', description: 'Engine overheating on highway.', date: 'Mar 28, 2026', status: 'In Progress' }
    ],
    insurance: {
      provider: 'Progressive',
      policyNumber: 'PRG-445566',
      expiryDate: 'Mar 10, 2026',
      status: 'Expired'
    }
  },
  {
    id: 'VEH-004',
    make: 'Toyota',
    model: 'RAV4',
    year: 2023,
    plateNumber: 'GHI-7766',
    vin: 'JTJBWRFV5PJ000004',
    type: 'SUV',
    status: 'In Use',
    mileage: '8,900 mi',
    fuelLevel: 45,
    assignedTo: 'Sarah Smith',
    lastService: 'Dec 10, 2025',
    nextService: 'Jun 10, 2026',
    maintenanceHistory: [],
    insurance: {
      provider: 'Allstate',
      policyNumber: 'ALS-112233',
      expiryDate: 'Oct 30, 2026',
      status: 'Valid'
    }
  },
  {
    id: 'VEH-005',
    make: 'Honda',
    model: 'Civic',
    year: 2022,
    plateNumber: 'SED-1100',
    vin: '1HGFC2F50NE000005',
    type: 'Sedan',
    status: 'Out of Service',
    mileage: '52,100 mi',
    fuelLevel: 0,
    lastService: 'Feb 20, 2026',
    nextService: 'Pending',
    maintenanceHistory: [],
    insurance: {
      provider: 'Liberty Mutual',
      policyNumber: 'LBM-778899',
      expiryDate: 'Jan 15, 2027',
      status: 'Valid'
    }
  }
];

export default function VehiclesPage() {
  const [vehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<VehicleStatus | 'All'>('All');
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState<boolean>(false);

  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch = 
      v.make.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.plateNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = activeFilter === 'All' || v.status === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusStyle = (status: VehicleStatus): string => {
    switch (status) {
      case 'Available': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'In Use': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'Maintenance': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'Out of Service': return 'bg-rose-50 text-rose-600 border-rose-100';
    }
  };

  const getPriorityStyle = (priority: MaintenancePriority): string => {
    switch (priority) {
      case 'Critical': return 'text-rose-600 bg-rose-50 border-rose-100';
      case 'High': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'Medium': return 'text-amber-600 bg-amber-50 border-amber-100';
      case 'Low': return 'text-blue-600 bg-blue-50 border-blue-100';
    }
  };

  const getFuelWidthClass = (level: number): string => {
    if (level >= 100) return 'w-full';
    if (level >= 91) return 'w-[91%]';
    if (level >= 83) return 'w-[83%]';
    if (level >= 75) return 'w-[75%]';
    if (level >= 66) return 'w-[66%]';
    if (level >= 58) return 'w-[58%]';
    if (level >= 50) return 'w-[50%]';
    if (level >= 41) return 'w-[41%]';
    if (level >= 33) return 'w-[33%]';
    if (level >= 25) return 'w-[25%]';
    if (level >= 16) return 'w-[16%]';
    if (level >= 8) return 'w-[8%]';
    return 'w-0';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Fleet Management</h1>
            <p className="text-gray-500 mt-1 font-medium">Monitor vehicle status, assignments, and maintenance</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsMaintenanceModalOpen(true)}
              className="px-6 py-3 bg-white border border-gray-200 text-rose-600 rounded-2xl font-bold text-sm hover:bg-rose-50 transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Issue
            </button>
            <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Vehicle
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Total Fleet', count: vehicles.length, color: 'text-gray-900' },
            { label: 'In Operation', count: vehicles.filter(v => v.status === 'In Use').length, color: 'text-blue-600' },
            { label: 'Available', count: vehicles.filter(v => v.status === 'Available').length, color: 'text-emerald-600' },
            { label: 'Unscheduled Alerts', count: vehicles.filter(v => v.maintenanceHistory.some(m => m.type === 'Unscheduled' && m.status !== 'Resolved')).length, color: 'text-rose-600' },
            { label: 'Insurance Review', count: vehicles.filter(v => v.insurance.status !== 'Valid').length, color: 'text-amber-600' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by make, model, or plate..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(['All', 'Available', 'In Use', 'Maintenance', 'Out of Service'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilter === status 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Vehicle Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredVehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              onClick={() => setSelectedVehicle(vehicle)}
              className="group bg-white rounded-[2.5rem] p-8 border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 uppercase tracking-widest">
                      {vehicle.type}
                    </span>
                    <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">{vehicle.id}</span>
                  </div>
                  <h3 className="text-xl font-black text-gray-900 group-hover:text-emerald-700 transition-colors">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h3>
                  <p className="text-sm font-bold text-gray-400 mt-1">{vehicle.plateNumber}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyle(vehicle.status)}`}>
                    {vehicle.status}
                  </div>
                  {vehicle.maintenanceHistory.some(m => m.type === 'Unscheduled' && m.status !== 'Resolved') && (
                    <div className="animate-pulse w-2 h-2 bg-rose-500 rounded-full" title="Active Unscheduled Issue" />
                  )}
                </div>
              </div>

              {/* Fuel/Charge Gauge */}
              <div className="mb-8">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {vehicle.type === 'Electric' ? 'Battery Charge' : 'Fuel Level'}
                  </span>
                  <span className="text-xs font-bold text-gray-900">{vehicle.fuelLevel}%</span>
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${getFuelWidthClass(vehicle.fuelLevel)} ${
                      vehicle.fuelLevel < 20 ? 'bg-rose-500' : 
                      vehicle.fuelLevel < 50 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 py-6 border-t border-gray-50">
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Mileage</p>
                  <p className="text-sm font-bold text-gray-900">{vehicle.mileage}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Assigned To</p>
                  <p className="text-sm font-bold text-gray-900 truncate">{vehicle.assignedTo || 'Unassigned'}</p>
                </div>
              </div>

              <button className="w-full py-3 bg-gray-50 text-gray-600 rounded-2xl font-bold text-xs group-hover:bg-emerald-600 group-hover:text-white transition-all">
                View Full Details
              </button>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredVehicles.length === 0 && (
          <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">No vehicles found</h3>
            <p className="text-gray-500 mt-1">Try adjusting your search or status filter.</p>
          </div>
        )}
      </div>

      {/* Unscheduled Maintenance Modal */}
      {isMaintenanceModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Report Incident</h2>
              <button onClick={() => setIsMaintenanceModalOpen(false)} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Select Vehicle</label>
                <select className="w-full px-5 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-700">
                  <option value="">Choose vehicle...</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.plateNumber} - {v.make} {v.model}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Urgency</label>
                  <select className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600">
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Issue Category</label>
                  <select className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600">
                    <option value="Engine">Engine</option>
                    <option value="Tires">Tires/Wheels</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Body">Body Work</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Description</label>
                <textarea 
                  placeholder="Describe the issue in detail..." 
                  rows={4}
                  className="w-full px-5 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                />
              </div>
              <button className="w-full py-4 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 font-bold text-sm hover:border-rose-300 hover:text-rose-600 transition-all flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Attach Photo
              </button>
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => setIsMaintenanceModalOpen(false)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => setIsMaintenanceModalOpen(false)}
                className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100"
              >
                Log Unscheduled Maintenance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Viewer Drawer */}
      {selectedVehicle && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity duration-500"
            onClick={() => setSelectedVehicle(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-8 pb-0">
              <div className="flex justify-end mb-4">
                <button 
                  onClick={() => setSelectedVehicle(null)}
                  className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-full h-48 bg-gray-100 rounded-[2.5rem] mb-6 flex items-center justify-center text-gray-300">
                   <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                </div>
                <h2 className="text-3xl font-black text-gray-900 mb-1">{selectedVehicle.year} {selectedVehicle.make}</h2>
                <p className="text-emerald-600 font-black uppercase tracking-[0.2em] text-xs mb-8">{selectedVehicle.model} • {selectedVehicle.plateNumber}</p>
              </div>
            </div>

            <div className="p-8 flex-1 space-y-8">
              {/* Technical Specs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">VIN</label>
                  <p className="text-xs font-bold text-gray-900 break-all">{selectedVehicle.vin}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Vehicle Type</label>
                  <p className="text-sm font-bold text-gray-900">{selectedVehicle.type}</p>
                </div>
              </div>

              {/* Insurance Section */}
              <div className={`p-6 rounded-[2rem] border transition-all ${
                selectedVehicle.insurance.status === 'Expired' ? 'bg-rose-50 border-rose-100' :
                selectedVehicle.insurance.status === 'Expiring Soon' ? 'bg-amber-50 border-amber-100' :
                'bg-emerald-50 border-emerald-100'
              }`}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Insurance Coverage</h4>
                  <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase border ${
                    selectedVehicle.insurance.status === 'Expired' ? 'text-rose-600 border-rose-200 bg-white' :
                    selectedVehicle.insurance.status === 'Expiring Soon' ? 'text-amber-600 border-amber-200 bg-white' :
                    'text-emerald-600 border-emerald-200 bg-white'
                  }`}>
                    {selectedVehicle.insurance.status}
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">Provider</span>
                    <span className="text-xs font-black text-gray-900">{selectedVehicle.insurance.provider}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">Policy #</span>
                    <span className="text-xs font-black text-gray-900">{selectedVehicle.insurance.policyNumber}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">Expires</span>
                    <span className={`text-xs font-black ${
                      selectedVehicle.insurance.status === 'Expired' ? 'text-rose-600' : 'text-gray-900'
                    }`}>{selectedVehicle.insurance.expiryDate}</span>
                  </div>
                </div>
              </div>

              {/* Maintenance History Section */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Maintenance History</h4>
                <div className="space-y-3">
                  {selectedVehicle.maintenanceHistory.length > 0 ? (
                    selectedVehicle.maintenanceHistory.map((log) => (
                      <div key={log.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start gap-4">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${log.status === 'Resolved' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-1">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${getPriorityStyle(log.priority)}`}>
                              {log.priority}
                            </span>
                            <span className="text-[10px] font-bold text-gray-400">{log.date}</span>
                          </div>
                          <p className="text-sm font-bold text-gray-900 mb-1">{log.type} Service</p>
                          <p className="text-xs text-gray-500 leading-relaxed">{log.description}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-10 border-2 border-dashed border-gray-100 rounded-2xl text-center">
                      <p className="text-xs font-bold text-gray-400">No maintenance records found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Assignments */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Current Assignment</h4>
                <div className="p-5 bg-white border border-gray-100 rounded-2xl flex items-center gap-4 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-black text-xs">
                    {selectedVehicle.assignedTo ? selectedVehicle.assignedTo.substring(0, 2).toUpperCase() : '??'}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{selectedVehicle.assignedTo || 'Not currently assigned'}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Operator</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-8 pt-4 bg-white border-t border-gray-50 sticky bottom-0 flex flex-col gap-3 text-center">
              <button className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100">
                Update Assignment
              </button>
              <button 
                onClick={() => {
                  setSelectedVehicle(null);
                  setIsMaintenanceModalOpen(true);
                }}
                className="w-full py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100"
              >
                Log Unscheduled Maintenance
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
