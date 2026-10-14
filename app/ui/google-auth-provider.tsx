'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Script from 'next/script';

import { useIsClient } from './use-client';

type GoogleAuthContextType = {
  token: string | null;
  loading: boolean;
  error: string | null;
  login: () => void;
  logout: () => void;
  gsiReady: boolean;
};

const GoogleAuthContext = createContext<GoogleAuthContextType>({
  token: null,
  loading: false,
  error: null,
  login: () => {},
  logout: () => {},
  gsiReady: false,
});

const STORAGE_KEY = 'la_erp_google_access_token';

/** The slice of Google Identity Services this provider touches. */
type TokenResponse = { error?: string; access_token: string };
type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: () => void;
      }) => { requestAccessToken: (options: { prompt: string }) => void };
    };
  };
};
const COMBINED_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');

export function GoogleAuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gsiReady, setGsiReady] = useState(false);

  // Pick up a token saved by an earlier visit once we are on the client. Done
  // during render rather than in an effect, so the first interactive frame
  // already knows whether the user is connected.
  const isClient = useIsClient();
  const [restored, setRestored] = useState(false);
  if (isClient && !restored) {
    setRestored(true);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (saved) setToken(saved);
  }

  const login = useCallback(() => {
    if (!gsiReady) {
      setError('Google Sign-In is not ready yet.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const goog = (globalThis as unknown as { google: GoogleIdentity }).google;
      const client = goog.accounts.oauth2.initTokenClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
        scope: COMBINED_SCOPES,
        callback: (resp: TokenResponse) => {
          if (resp.error) {
            setError('Google sign-in failed. Please try again.');
            setLoading(false);
            return;
          }
          const accessToken = resp.access_token;
          setToken(accessToken);
          localStorage.setItem(STORAGE_KEY, accessToken);
          setLoading(false);
        },
        error_callback: () => {
          setError('An error occurred during Google sign-in.');
          setLoading(false);
        }
      });
      client.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [gsiReady]);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
    // Also remove the old legacy tokens so they don't cause conflicts if someone downgrades
    localStorage.removeItem('gdrive_access_token');
  }, []);

  return (
    <GoogleAuthContext.Provider value={{ token, loading, error, login, logout, gsiReady }}>
      <Script src="https://accounts.google.com/gsi/client" onLoad={() => setGsiReady(true)} strategy="afterInteractive" />
      {children}
    </GoogleAuthContext.Provider>
  );
}

export function useGoogleAuth() {
  return useContext(GoogleAuthContext);
}
