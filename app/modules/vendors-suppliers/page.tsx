'use client';

import React, { useState } from 'react';

type Vendor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  category: 'Raw Materials' | 'Equipment' | 'Services' | 'Logistics';
  rating: number;
  status: 'Active' | 'Inactive' | 'On Hold';
  paymentTerms: string;
  location: string;
  lastContact: string;
  totalOrders: number;
  totalSpent: string;
};

export default function VendorsSuppliersPage() {
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [editedVendor, setEditedVendor] = useState<Vendor | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Raw Materials' | 'Equipment' | 'Services' | 'Logistics'>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'Active' | 'Inactive' | 'On Hold'>('All');
  const [vendors, setVendors] = useState<Vendor[]>([
    { id: 'V-001', name: 'Premium Steel Supplies', email: 'info@premiumsteel.com', phone: '+1-555-0101', category: 'Raw Materials', rating: 4.8, status: 'Active', paymentTerms: 'Net 30', location: 'Cleveland, OH', lastContact: 'Mar 28', totalOrders: 145, totalSpent: '$285,000' },
    { id: 'V-002', name: 'Global Electronics Ltd', email: 'sales@globalelec.com', phone: '+1-555-0102', category: 'Equipment', rating: 4.5, status: 'Active', paymentTerms: 'Net 45', location: 'San Jose, CA', lastContact: 'Mar 25', totalOrders: 89, totalSpent: '$450,200' },
    { id: 'V-003', name: 'Swift Logistics Partners', email: 'ops@swiftlogistics.com', phone: '+1-555-0103', category: 'Logistics', rating: 4.6, status: 'Active', paymentTerms: 'Net 15', location: 'Atlanta, GA', lastContact: 'Mar 29', totalOrders: 267, totalSpent: '$125,300' },
    { id: 'V-004', name: 'Tech Maintenance Services', email: 'support@techmaint.com', phone: '+1-555-0104', category: 'Services', rating: 4.3, status: 'Active', paymentTerms: 'Monthly', location: 'Boston, MA', lastContact: 'Mar 20', totalOrders: 42, totalSpent: '$95,600' },
    { id: 'V-005', name: 'Industrial Polymers Inc', email: 'contact@indpoly.com', phone: '+1-555-0105', category: 'Raw Materials', rating: 4.2, status: 'Active', paymentTerms: 'Net 60', location: 'Houston, TX', lastContact: 'Mar 15', totalOrders: 67, totalSpent: '$320,500' },
    { id: 'V-006', name: 'Precision Machine Tools', email: 'sales@precisiontools.com', phone: '+1-555-0106', category: 'Equipment', rating: 4.9, status: 'Active', paymentTerms: 'Net 30', location: 'Detroit, MI', lastContact: 'Mar 27', totalOrders: 53, totalSpent: '$875,200' },
    { id: 'V-007', name: 'Chemical Solutions Group', email: 'inquiry@chemsol.com', phone: '+1-555-0107', category: 'Raw Materials', rating: 3.8, status: 'On Hold', paymentTerms: 'Net 45', location: 'Newark, NJ', lastContact: 'Mar 10', totalOrders: 34, totalSpent: '$189,400' },
    { id: 'V-008', name: 'Express Courier Network', email: 'dispatch@expresscourier.com', phone: '+1-555-0108', category: 'Logistics', rating: 4.4, status: 'Active', paymentTerms: 'Net 15', location: 'Chicago, IL', lastContact: 'Mar 29', totalOrders: 512, totalSpent: '$234,100' },
    { id: 'V-009', name: 'Quality Control Labs', email: 'testing@qclab.com', phone: '+1-555-0109', category: 'Services', rating: 4.7, status: 'Active', paymentTerms: 'Monthly', location: 'Austin, TX', lastContact: 'Mar 26', totalOrders: 28, totalSpent: '$76,800' },
    { id: 'V-010', name: 'Sustainable Packaging Co', email: 'orders@sustpack.com', phone: '+1-555-0110', category: 'Raw Materials', rating: 4.6, status: 'Active', paymentTerms: 'Net 30', location: 'Portland, OR', lastContact: 'Mar 22', totalOrders: 78, totalSpent: '$142,300' },
  ]);

  const filteredVendors = vendors.filter((vendor) => {
    const matchesSearch = vendor.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          vendor.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          vendor.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || vendor.category === selectedCategory;
    const matchesStatus = selectedStatus === 'All' || vendor.status === selectedStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      'Raw Materials': 'bg-blue-100 text-blue-700 border-blue-300',
      'Equipment': 'bg-purple-100 text-purple-700 border-purple-300',
      'Services': 'bg-green-100 text-green-700 border-green-300',
      'Logistics': 'bg-orange-100 text-orange-700 border-orange-300',
    };
    return colors[category] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      'Active': 'bg-emerald-100 text-emerald-700',
      'Inactive': 'bg-gray-100 text-gray-700',
      'On Hold': 'bg-yellow-100 text-yellow-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4.7) return 'text-emerald-600';
    if (rating >= 4.3) return 'text-blue-600';
    if (rating >= 4) return 'text-yellow-600';
    return 'text-orange-600';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Vendors & Suppliers</h1>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <input
              type="text"
              placeholder="Search by name, email, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
            <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm whitespace-nowrap">
              + Add Vendor
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {/* Category Filter */}
            <div className="flex gap-2">
              <span className="text-sm font-semibold text-gray-600 py-2">Category:</span>
              {['All', 'Raw Materials', 'Equipment', 'Services', 'Logistics'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat as 'All' | 'Raw Materials' | 'Equipment' | 'Services' | 'Logistics')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    selectedCategory === cat ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="flex gap-2 ml-4">
              <span className="text-sm font-semibold text-gray-600 py-2">Status:</span>
              {['All', 'Active', 'Inactive', 'On Hold'].map((status) => (
                <button
                  key={status}
                  onClick={() => setSelectedStatus(status as 'All' | 'Active' | 'Inactive' | 'On Hold')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    selectedStatus === status ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {filteredVendors.length > 0 ? (
          <div className="space-y-4">
            {filteredVendors.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                onClick={() => {
                  setSelectedVendor(vendor);
                  setEditedVendor({ ...vendor });
                }}
                className="w-full bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-all text-left hover:border-emerald-300"
              >
                <div className="flex items-start justify-between gap-6">
                  {/* Left Section - Company Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-4 mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900">{vendor.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getCategoryColor(vendor.category)}`}>
                            {vendor.category}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(vendor.status)}`}>
                            {vendor.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Contact & Location */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">Email</p>
                        <p className="text-gray-900 font-medium break-all">{vendor.email}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">Phone</p>
                        <p className="text-gray-900 font-medium">{vendor.phone}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">Location</p>
                        <p className="text-gray-900 font-medium">{vendor.location}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">Payment Terms</p>
                        <p className="text-gray-900 font-medium">{vendor.paymentTerms}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">Last Contact</p>
                        <p className="text-gray-900 font-medium">{vendor.lastContact}</p>
                      </div>
                    </div>
                  </div>

                  {/* Right Section - Stats */}
                  <div className="shrink-0 text-right space-y-3">
                    {/* Rating */}
                    <div>
                      <div className="flex items-center justify-end gap-1 mb-1">
                        <svg className={`w-5 h-5 ${getRatingColor(vendor.rating)}`} fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        <span className={`font-bold text-lg ${getRatingColor(vendor.rating)}`}>{vendor.rating}</span>
                      </div>
                      <p className="text-xs text-gray-500">Rating</p>
                    </div>

                    {/* Orders */}
                    <div>
                      <p className="font-bold text-lg text-gray-900">{vendor.totalOrders}</p>
                      <p className="text-xs text-gray-500">Total Orders</p>
                    </div>

                    {/* Total Spent */}
                    <div>
                      <p className="font-bold text-lg text-emerald-600">{vendor.totalSpent}</p>
                      <p className="text-xs text-gray-500">Total Spent</p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500 text-sm">No vendors found. Try adjusting your filters.</p>
          </div>
        )}
      </div>

      {/* Blur Overlay */}
      {selectedVendor && (
        <button
          type="button"
          onClick={() => {
            setSelectedVendor(null);
            setEditedVendor(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSelectedVendor(null);
              setEditedVendor(null);
            }
          }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        />
      )}

      {/* Side Drawer */}
      {selectedVendor && editedVendor && (
        <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300 ease-out">
          {/* Top Action Bar */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getCategoryColor(editedVendor.category)}`}>
                {editedVendor.category}
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(editedVendor.status)}`}>
                {editedVendor.status}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  setSelectedVendor(null);
                  setEditedVendor(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Company Name & Rating */}
            <div className="mb-6">
              <input
                type="text"
                value={editedVendor.name}
                onChange={(e) => setEditedVendor({ ...editedVendor, name: e.target.value })}
                className="text-3xl font-bold text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-2 mb-3"
              />
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span className="font-bold text-lg text-gray-900">{editedVendor.rating}/5</span>
              </div>
            </div>

            {/* Contact Information */}
            <div className="mb-6 pb-6 border-b border-gray-200 space-y-4">
              <div>
                <label htmlFor="vendor-email" className="block text-sm font-semibold text-gray-900 mb-2">Email</label>
                <input
                  id="vendor-email"
                  type="email"
                  value={editedVendor.email}
                  onChange={(e) => setEditedVendor({ ...editedVendor, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
              <div>
                <label htmlFor="vendor-phone" className="block text-sm font-semibold text-gray-900 mb-2">Phone</label>
                <input
                  id="vendor-phone"
                  type="tel"
                  value={editedVendor.phone}
                  onChange={(e) => setEditedVendor({ ...editedVendor, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
              <div>
                <label htmlFor="vendor-location" className="block text-sm font-semibold text-gray-900 mb-2">Location</label>
                <input
                  id="vendor-location"
                  type="text"
                  value={editedVendor.location}
                  onChange={(e) => setEditedVendor({ ...editedVendor, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
            </div>

            {/* Business Information */}
            <div className="mb-6 pb-6 border-b border-gray-200 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Category</label>
                <select
                  value={editedVendor.category}
                  onChange={(e) => setEditedVendor({ ...editedVendor, category: e.target.value as 'Raw Materials' | 'Equipment' | 'Services' | 'Logistics' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                >
                  <option value="Raw Materials">Raw Materials</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Services">Services</option>
                  <option value="Logistics">Logistics</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Status</label>
                <select
                  value={editedVendor.status}
                  onChange={(e) => setEditedVendor({ ...editedVendor, status: e.target.value as 'Active' | 'Inactive' | 'On Hold' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </div>
              <div>
                <label htmlFor="vendor-payment-terms" className="block text-sm font-semibold text-gray-900 mb-2">Payment Terms</label>
                <input
                  id="vendor-payment-terms"
                  type="text"
                  value={editedVendor.paymentTerms}
                  onChange={(e) => setEditedVendor({ ...editedVendor, paymentTerms: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  placeholder="e.g., Net 30, Net 45, Monthly"
                />
              </div>
            </div>

            {/* Statistics */}
            <div className="mb-6 pb-6 border-b border-gray-200 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Total Orders</label>
                <p className="text-2xl font-bold text-gray-900">{editedVendor.totalOrders}</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Total Spent</label>
                <p className="text-2xl font-bold text-emerald-600">{editedVendor.totalSpent}</p>
              </div>
            </div>

            {/* Last Contact */}
            <div>
              <label htmlFor="vendor-last-contact" className="block text-sm font-semibold text-gray-900 mb-2">Last Contact</label>
              <input
                id="vendor-last-contact"
                type="text"
                value={editedVendor.lastContact}
                onChange={(e) => setEditedVendor({ ...editedVendor, lastContact: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                placeholder="e.g., Mar 28"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
            <button
              onClick={() => {
                const updatedVendors = vendors.map((v) => (v.id === editedVendor.id ? editedVendor : v));
                setVendors(updatedVendors);
                setSelectedVendor(null);
                setEditedVendor(null);
              }}
              className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors"
            >
              Save Changes
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedVendor(null);
                  setEditedVendor(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setVendors(vendors.filter((v) => v.id !== selectedVendor.id));
                  setSelectedVendor(null);
                  setEditedVendor(null);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
