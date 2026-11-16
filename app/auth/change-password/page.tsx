'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import Link from 'next/link';

import { PasswordInput } from '@/app/auth/_components/password-input';

export default function ChangePasswordPage() {
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Unable to change your password');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsDone(true);
    } catch (caughtError) {
      console.error(caughtError);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', textAlign: 'center' }}>Change Password</h1>

        {isDone ? (
          <>
            <div role="status" style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#efe', border: '1px solid #cdc', color: '#060', fontSize: '14px' }}>
              Your password has been changed. You have been signed out on every device, so sign in again with the new password.
            </div>
            <Link
              href="/auth/login"
              style={{
                display: 'block',
                padding: '10px',
                backgroundColor: '#000',
                color: '#fff',
                border: '1px solid #000',
                fontSize: '14px',
                fontWeight: 'bold',
                textAlign: 'center',
              }}
            >
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            {error && (
              <div role="alert" style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#fee', border: '1px solid #fcc', color: '#c00', fontSize: '14px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label htmlFor="email" style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontSize: '14px', fontFamily: 'monospace' }}
                />
              </div>

              <PasswordInput
                id="current-password"
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="Enter your current password"
                autoComplete="current-password"
              />

              <PasswordInput
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="Choose a new password"
                autoComplete="new-password"
                hint="At least 8 characters, with a letter and a number."
              />

              <PasswordInput
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Type the new password again"
                autoComplete="new-password"
              />

              <button
                type="submit"
                disabled={isLoading}
                style={{
                  padding: '10px',
                  marginTop: '16px',
                  backgroundColor: isLoading ? '#ccc' : '#000',
                  color: '#fff',
                  border: '1px solid #000',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {isLoading ? 'Changing password...' : 'Change password'}
              </button>
            </form>

            <p style={{ textAlign: 'center', fontSize: '12px', marginTop: '16px', color: '#666' }}>
              <Link href="/auth/login" style={{ color: '#666', textDecoration: 'underline' }}>
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
