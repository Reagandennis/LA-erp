'use client';

import React, { useState } from 'react';

// --- Types ---
type PersonnelStatus = 'Active' | 'On Leave' | 'Terminated' | 'Remote';
type Department = 'Engineering' | 'Operations' | 'Human Resources' | 'Finance' | 'Sales' | 'Product';
type DepartmentFilter = 'All' | Department;

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: Department;
  status: PersonnelStatus;
  avatar: string;
  joinDate: string;
  location: string;
  manager: string;
  skills: string[];
}

// --- Mock Data ---
const MOCK_EMPLOYEES: Employee[] = [
  {
    id: 'EMP-001',
    name: 'Sarah Smith',
    email: 'sarah.s@example.com',
    phone: '+1 (555) 123-4567',
    role: 'Product Lead',
    department: 'Product',
    status: 'Active',
    avatar: 'SS',
    joinDate: 'Jan 15, 2024',
    location: 'New York, NY',
    manager: 'John Davis',
    skills: ['Product Strategy', 'UI/UX', 'Agile']
  },
  {
    id: 'EMP-002',
    name: 'Michael Ross',
    email: 'm.ross@example.com',
    phone: '+1 (555) 987-6543',
    role: 'Senior Backend Engineer',
    department: 'Engineering',
    status: 'Remote',
    avatar: 'MR',
    joinDate: 'Mar 10, 2023',
    location: 'Chicago, IL',
    manager: 'Sarah Smith',
    skills: ['Node.js', 'Prisma', 'PostgreSQL']
  },
  {
    id: 'EMP-003',
    name: 'Emily Blunt',
    email: 'e.blunt@example.com',
    phone: '+1 (555) 246-8135',
    role: 'HR Manager',
    department: 'Human Resources',
    status: 'Active',
    avatar: 'EB',
    joinDate: 'Jul 22, 2022',
    location: 'London, UK',
    manager: 'David Miller',
    skills: ['Recruitment', 'Conflict Resolution', 'Onboarding']
  },
  {
    id: 'EMP-004',
    name: 'John Doe',
    email: 'j.doe@example.com',
    phone: '+1 (555) 369-1470',
    role: 'Financial Analyst',
    department: 'Finance',
    status: 'On Leave',
    avatar: 'JD',
    joinDate: 'Nov 05, 2023',
    location: 'Austin, TX',
    manager: 'Emily Blunt',
    skills: ['Financial Modeling', 'Excel', 'Reporting']
  },
  {
    id: 'EMP-005',
    name: 'Olivia Wilson',
    email: 'o.wilson@example.com',
    phone: '+1 (555) 753-9514',
    role: 'Operations Coordinator',
    department: 'Operations',
    status: 'Active',
    avatar: 'OW',
    joinDate: 'Feb 14, 2024',
    location: 'Berlin, DE',
    manager: 'Sarah Smith',
    skills: ['Logistics', 'Planning', 'Resource Management']
  }
];

export default function PersonnelPage() {
  const [employees] = useState<Employee[]>(MOCK_EMPLOYEES);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDept, setActiveDept] = useState<DepartmentFilter>('All');
  const departmentOptions: DepartmentFilter[] = ['All', 'Engineering', 'Operations', 'Human Resources', 'Finance', 'Sales', 'Product'];

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         emp.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = activeDept === 'All' || emp.department === activeDept;
    return matchesSearch && matchesDept;
  });

  const getStatusStyle = (status: PersonnelStatus) => {
    switch (status) {
      case 'Active': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Remote': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'On Leave': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'Terminated': return 'bg-rose-50 text-rose-600 border-rose-100';
    }
  };

  const getAvatarColor = (name: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Personnel Directory</h1>
            <p className="text-gray-500 mt-1 font-medium">Manage team members, roles, and departments</p>
          </div>
          <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Add Member
          </button>
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {departmentOptions.map((dept) => (
              <button
                key={dept}
                onClick={() => setActiveDept(dept)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeDept === dept 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        {/* Personnel Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredEmployees.map((emp) => (
            <div
              key={emp.id}
              onClick={() => setSelectedEmployee(emp)}
              className="group bg-white rounded-[2rem] p-6 border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
            >
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-white font-bold text-2xl shadow-xl transition-transform group-hover:scale-105 duration-300 ${getAvatarColor(emp.name)}`}>
                    {emp.avatar}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-white ${
                    emp.status === 'Active' ? 'bg-emerald-500' : 
                    emp.status === 'Remote' ? 'bg-blue-500' : 
                    emp.status === 'On Leave' ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                </div>
                
                <h3 className="text-lg font-black text-gray-900 group-hover:text-emerald-700 transition-colors truncate w-full">
                  {emp.name}
                </h3>
                <p className="text-emerald-600 font-black uppercase tracking-[0.1em] text-[10px] mb-4">{emp.role}</p>
                
                <div className="w-full space-y-3 pt-4 border-t border-gray-50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-bold uppercase tracking-widest">Department</span>
                    <span className="text-gray-900 font-bold">{emp.department}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-bold uppercase tracking-widest">Join Date</span>
                    <span className="text-gray-900 font-bold">{emp.joinDate}</span>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className={`mt-6 py-2 rounded-xl border text-center text-[10px] font-black uppercase tracking-widest ${getStatusStyle(emp.status)}`}>
                {emp.status}
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredEmployees.length === 0 && (
          <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">No personnel found</h3>
            <p className="text-gray-500 mt-1">Try adjusting your search or department filter.</p>
          </div>
        )}
      </div>

      {/* Profile Drawer */}
      {selectedEmployee && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity duration-500"
            onClick={() => setSelectedEmployee(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-8 pb-0">
              <div className="flex justify-end mb-4">
                <button 
                  onClick={() => setSelectedEmployee(null)}
                  className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className={`w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-white font-bold text-4xl shadow-2xl ${getAvatarColor(selectedEmployee.name)}`}>
                    {selectedEmployee.avatar}
                  </div>
                  <div className={`absolute bottom-2 right-2 w-8 h-8 rounded-full border-4 border-white ${
                    selectedEmployee.status === 'Active' ? 'bg-emerald-500' : 
                    selectedEmployee.status === 'Remote' ? 'bg-blue-500' : 'bg-amber-500'
                  }`} />
                </div>
                <h2 className="text-3xl font-black text-gray-900 mb-1">{selectedEmployee.name}</h2>
                <p className="text-emerald-600 font-black uppercase tracking-[0.2em] text-xs mb-8">{selectedEmployee.role}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <button className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email
                </button>
                <button className="flex-1 py-4 bg-gray-900 text-white rounded-2xl font-bold text-sm hover:bg-black transition-all flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Call
                </button>
              </div>
            </div>

            <div className="px-8 pb-8 flex-1 space-y-8">
              {/* Detailed Info */}
              <div className="bg-gray-50 rounded-[2rem] p-6 border border-gray-100 space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Full Name</label>
                  <p className="text-sm font-bold text-gray-900">{selectedEmployee.name}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Department</label>
                  <p className="text-sm font-bold text-gray-900">{selectedEmployee.department}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Work Location</label>
                  <p className="text-sm font-bold text-gray-900">{selectedEmployee.location}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Reports To</label>
                  <p className="text-sm font-bold text-gray-900">{selectedEmployee.manager}</p>
                </div>
              </div>

              {/* Skills */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Skills & Expertise</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedEmployee.skills.map(skill => (
                    <span key={skill} className="px-3 py-1.5 bg-white border border-gray-100 rounded-xl text-xs font-bold text-gray-600 shadow-sm">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="pt-8 border-t border-gray-100 flex flex-col gap-3">
                <button className="w-full py-4 border-2 border-emerald-600 text-emerald-600 rounded-2xl font-bold text-sm hover:bg-emerald-50 transition-all">
                  Edit Profile
                </button>
                <button className="w-full py-4 text-rose-500 font-bold text-sm hover:bg-rose-50 rounded-2xl transition-all">
                  Terminate Access
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
