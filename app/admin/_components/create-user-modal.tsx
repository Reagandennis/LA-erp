'use client';

import { useState } from 'react';

import { adminFetch, errorMessage } from './admin-api';
import type { AdminRole } from './admin-types';
import { Modal, generatePassword, inputClass, isValidPassword, primaryButton, secondaryButton } from './admin-ui';

export default function CreateUserModal({
  roles,
  emailConfigured,
  onClose,
  onCreated,
}: {
  roles: AdminRole[];
  /** Whether a welcome email goes out, so the admin knows to share details themselves if not. */
  emailConfigured: boolean;
  onClose: () => void;
  onCreated: (userId: number, message: string) => Promise<void>;
}) {
  const defaultRole = roles.find((r) => r.name === 'viewer') ?? roles.find((r) => !r.isAdmin);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    status: 'active',
    roleIds: defaultRole ? [defaultRole.id] : [],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const valid =
    form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email) && isValidPassword(form.password) && form.roleIds.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = await adminFetch<{ user: { id: number; name: string }; welcomeEmailed?: boolean }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, moduleIds: [] }),
      });
      await onCreated(
        payload.user.id,
        payload.welcomeEmailed
          ? `${payload.user.name} was created and emailed their sign-in details.`
          : `${payload.user.name} was created. Share their password with them securely.`,
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not create the user.'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRole = (id: number) =>
    setForm((f) => ({ ...f, roleIds: f.roleIds.includes(id) ? f.roleIds.filter((r) => r !== id) : [...f.roleIds, id] }));

  return (
    <Modal
      title="New user"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" form="create-user-form" disabled={!valid || submitting} className={primaryButton}>
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Full name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Email</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} required />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-gray-600">Password</span>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={`${inputClass} pr-16 font-mono`}
                aria-label="Password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setForm({ ...form, password: generatePassword() });
                setShowPassword(true);
              }}
              className={secondaryButton}
            >
              Generate
            </button>
          </div>
          <p className={`mt-1.5 text-xs ${form.password && !isValidPassword(form.password) ? 'text-rose-600' : 'text-gray-500'}`}>
            At least 8 characters with a letter and a number.
            {emailConfigured ? ' They are emailed their sign-in details.' : ' Email is not set up, so share it with them yourself.'}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-gray-600">Status</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
            <option value="active">Active: can sign in now</option>
            <option value="inactive">Inactive: account ready, sign-in blocked</option>
          </select>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-gray-600">Roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              const on = form.roleIds.includes(role.id);
              return (
                <label
                  key={role.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                    on ? 'border-[#03458f]/30 bg-blue-50/60' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleRole(role.id)} className="mt-0.5 h-4 w-4 rounded accent-[#03458f]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold capitalize text-gray-900">{role.name}</span>
                    <span className="block text-xs text-gray-500">
                      {role.isAdmin ? 'Everything, including this console' : `${role.moduleIds.length} module${role.moduleIds.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">You can grant individual modules after creating the account.</p>
        </fieldset>
      </form>
    </Modal>
  );
}
