'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';

type CredentialResponse = { credential?: string };

type GoogleIdApi = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: Record<string, string | number>,
      ) => void;
    };
  };
};

function getGoogleApi(): GoogleIdApi | null {
  return (globalThis as unknown as { google?: GoogleIdApi }).google ?? null;
}

export function GoogleSignInButton({
  onError,
  onStart,
}: Readonly<{
  onError: (message: string) => void;
  onStart: () => void;
}>) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [gsiReady, setGsiReady] = useState(false);

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        onError('Google did not return a credential. Please try again.');
        return;
      }

      onStart();

      try {
        const result = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ credential: response.credential }),
        });

        const data = await result.json();

        if (!result.ok) {
          onError(data.error || 'Unable to sign in with Google');
          return;
        }

        // Full reload so the new session cookie is picked up server-side.
        window.location.assign('/dashboard');
      } catch (caughtError) {
        console.error(caughtError);
        onError('An unexpected error occurred. Please try again.');
      }
    },
    [onError, onStart],
  );

  useEffect(() => {
    if (!gsiReady || !clientId || !containerRef.current) {
      return;
    }

    const google = getGoogleApi();

    if (!google) {
      return;
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      cancel_on_tap_outside: true,
    });

    google.accounts.id.renderButton(containerRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: 368,
    });
  }, [clientId, gsiReady, handleCredential]);

  if (!clientId) {
    return null;
  }

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGsiReady(true)}
        onError={() => onError('Could not load Google Sign-In.')}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '20px 0 16px' }}>
        <span style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }} />
        <span style={{ fontSize: '12px', color: '#666' }}>or</span>
        <span style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }} />
      </div>

      <div ref={containerRef} style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }} />
    </>
  );
}
