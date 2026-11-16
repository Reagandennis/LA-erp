'use client';

import { ChangeEvent, useState } from 'react';

/**
 * A password field with a Show / Hide switch, so people can check what they
 * typed. Shared by the sign-in and change-password forms.
 */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  hint,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}>) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className="password-input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          // Shown as plain text, a password must still not be autocorrected,
          // capitalised or sent to a spell checker.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hintId}
          required
          style={{
            width: '100%',
            padding: '8px 60px 8px 8px',
            border: '1px solid #ccc',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            height: '100%',
            width: '56px',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#666',
            cursor: 'pointer',
          }}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p id={hintId} style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
