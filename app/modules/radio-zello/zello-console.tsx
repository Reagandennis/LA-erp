'use client';

import Link from 'next/link';

import { APP_LOCALE } from '@/lib/locale';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ZelloChannel,
  hasVoiceSupport,
  type ZelloConfig,
  type ZelloLocation,
  type ZelloLogEntry,
  type ZelloStatus,
  type ZelloVoiceClip,
} from './zello-channel';
import ZelloMap, { type MapDevice } from './zello-map';
import { ZELLO_KICKED, ZelloPresenceWatcher, logonChannelList, type ChannelPresence, type PresenceWatchState } from './zello-channel';

/** Zello's terse "kicked" means another device signed in as the same user. */
function explainZelloError(message: string, username: string): string {
  if (message === ZELLO_KICKED) {
    return `Signed out by Zello: another device or console is using the Zello user "${username || 'this user'}". Zello allows one session per user, so give this console its own Zello Work user.`;
  }
  return message;
}
import { StatusDot, type StatusVariant } from '@/app/ui/status-dot';
import { useIsClient } from '@/app/ui/use-client';
import { startVisibleInterval } from '@/lib/visible-interval';

const STORAGE_KEY = 'la-erp.zello.config';
const BLANK: ZelloConfig = { network: '', channel: '', username: '', password: '', authToken: '' };

const STATUS_META: Record<
  ZelloStatus,
  { label: string; variant: StatusVariant; text: string }
> = {
  idle: { label: 'Offline', variant: 'offline', text: 'text-gray-500' },
  connecting: { label: 'Connecting…', variant: 'warning', text: 'text-amber-600' },
  authenticating: { label: 'Signing in…', variant: 'warning', text: 'text-amber-600' },
  online: { label: 'On air', variant: 'online', text: 'text-emerald-600' },
  error: { label: 'Error', variant: 'danger', text: 'text-rose-600' },
  closed: { label: 'Disconnected', variant: 'offline', text: 'text-gray-500' },
};

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

function timeOf(at: number) {
  return new Date(at).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A traffic entry — a system/text line, or a captured voice clip with replay + transcript. */
type ConsoleEntry = ZelloLogEntry & {
  audioUrl?: string;
  durationMs?: number;
  transcribing?: boolean;
  transcript?: string;
  translation?: string;
  transcriptError?: boolean;
};

/** Compact play/stop button for a captured transmission. */
function ClipPlayer({ url, durationMs }: { url: string; durationMs?: number }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (!audioRef.current) {
      const a = new Audio(url);
      a.onended = () => setPlaying(false);
      audioRef.current = a;
    }
    const a = audioRef.current;
    if (playing) {
      a.pause();
      a.currentTime = 0;
      setPlaying(false);
    } else {
      a.currentTime = 0;
      void a.play();
      setPlaying(true);
    }
  };

  const secs = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20"
    >
      {playing ? (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {secs ? `${secs}s` : 'Play'}
    </button>
  );
}

export default function ZelloConsole() {
  const [config, setConfig] = useState<ZelloConfig>(BLANK);
  const [status, setStatus] = useState<ZelloStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [online, setOnline] = useState(0);
  const [talking, setTalking] = useState<string | null>(null);
  const [log, setLog] = useState<ConsoleEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState('');
  const [transmitting, setTransmitting] = useState(false);
  // Assume voice support on the server and during hydration; the real answer
  // is derived once we are on the client.
  const isClient = useIsClient();
  const voice = isClient ? hasVoiceSupport() : true;
  const [channels, setChannels] = useState<string[]>([]);
  // Live per-channel presence while connected (Zello reports a count, never names).
  const [presence, setPresence] = useState<Record<string, ChannelPresence>>({});
  // Channel membership per Zello user (lower-cased name), from the roster. A
  // logon may only name channels the user belongs to, so presence is watched
  // for exactly those.
  const [memberships, setMemberships] = useState<Record<string, string[]>>({});
  // Background presence while not connected (see ZelloPresenceWatcher).
  const [presenceState, setPresenceState] = useState<PresenceWatchState>('stopped');
  const [presenceNote, setPresenceNote] = useState<string | null>(null);
  // Bumped by the "Retry" link after a kick, which otherwise stops the watcher for good.
  const [presenceAttempt, setPresenceAttempt] = useState(0);
  const watcherRef = useRef<ZelloPresenceWatcher | null>(null);
  // Channel creation is admin-only; canManage comes from /api/zello/roster.
  const [canManage, setCanManage] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [newChannelError, setNewChannelError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MapDevice[]>([]);
  // Device-tracking map controls: focus a single device / re-frame all of them.
  const [mapFocus, setMapFocus] = useState<{ from: string; n: number } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  // null = unknown yet (not connected); true/false reported by on_channel_status.
  const [locationsSupported, setLocationsSupported] = useState<boolean | null>(null);

  const channelRef = useRef<ZelloChannel | null>(null);
  const transmittingRef = useRef(false);
  const clipUrlsRef = useRef<string[]>([]);
  const transcribeOffRef = useRef(false);
  const [transcribeOff, setTranscribeOff] = useState(false);

  useEffect(
    () => () => {
      channelRef.current?.disconnect();
      clipUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  useEffect(() => {
    fetch('/api/zello/roster', { credentials: 'include' })
      .then((r) => r.json())
      .catch(() => null)
      .then((d: { channels?: { name: string }[]; users?: { name: string; channels?: string[] }[]; canManage?: boolean } | null) => {
        if (d?.channels?.length) setChannels(d.channels.map((c) => c.name).filter(Boolean));
        if (d?.users?.length) {
          setMemberships(Object.fromEntries(d.users.map((u) => [u.name.toLowerCase(), u.channels ?? []])));
        }
        setCanManage(Boolean(d?.canManage));
      });
    let saved: Partial<ZelloConfig> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    fetch('/api/zello/token', { credentials: 'include' })
      .then((r) => r.json())
      .catch(() => null)
      .then((d: { network?: string; channel?: string } | null) => {
        const next: ZelloConfig = {
          network: saved.network ?? d?.network ?? '',
          channel: saved.channel ?? d?.channel ?? '',
          username: saved.username ?? '',
          password: saved.password ?? '',
          authToken: saved.authToken ?? '',
        };
        setConfig(next);
        if (!next.channel) setShowSettings(true);
      });
  }, []);

  const pushLog = useCallback((entry: ConsoleEntry) => {
    setLog((cur) => [entry, ...cur].slice(0, 300));
  }, []);

  // Persist one piece of traffic so switching channels (or reloading) keeps the history.
  const saveActivity = useCallback(
    async (
      cfg: ZelloConfig,
      a: {
        kind: 'voice' | 'text';
        from: string;
        direction: 'in' | 'out';
        text?: string;
        transcript?: string;
        translation?: string;
        language?: string;
        durationMs?: number;
        at: number;
        audio?: Blob;
      },
    ) => {
      if (!cfg.channel) return;
      const { audio, ...meta } = a;
      try {
        const res = await fetch('/api/zello/activity', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ network: cfg.network, channel: cfg.channel, ...meta }),
        });
        const d = (await res.json().catch(() => null)) as { id?: number } | null;
        // Upload the recording as a follow-up PUT so the metadata row stays lean.
        if (audio && d?.id) {
          await fetch(`/api/zello/activity/${d.id}/audio`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'audio/wav' },
            body: audio,
          });
        }
      } catch {
        /* persistence is best-effort */
      }
    },
    [],
  );

  // Load a channel's stored history (newest first) and append it below the live entries.
  const loadHistory = useCallback(async (cfg: ZelloConfig) => {
    if (!cfg.channel) return;
    try {
      const res = await fetch(
        `/api/zello/activity?network=${encodeURIComponent(cfg.network)}&channel=${encodeURIComponent(cfg.channel)}`,
        { credentials: 'include' },
      );
      const d = (await res.json().catch(() => null)) as { items?: Record<string, unknown>[] } | null;
      if (!d?.items?.length) return;
      const hist: ConsoleEntry[] = d.items.map((it) => ({
        id: `db-${it.id}`,
        kind: (it.kind as ConsoleEntry['kind']) ?? 'text',
        from: String(it.fromName ?? ''),
        text: String(it.text ?? ''),
        at: new Date(String(it.at)).getTime(),
        durationMs: typeof it.durationMs === 'number' ? it.durationMs : undefined,
        audioUrl: it.hasAudio ? `/api/zello/activity/${it.id}/audio` : undefined,
        transcript: it.transcript ? String(it.transcript) : undefined,
        translation: it.translation ? String(it.translation) : undefined,
      }));
      setLog((cur) => {
        const seen = new Set(cur.map((e) => e.id));
        return [...cur, ...hist.filter((h) => !seen.has(h.id))].slice(0, 300);
      });
    } catch {
      /* ignore */
    }
  }, []);

  const transcribeClip = useCallback(
    async (clip: ZelloVoiceClip, cfg: ZelloConfig) => {
      let transcript = '';
      let translation = '';
      let language = '';
      let failed = true;
      try {
        const res = await fetch('/api/zello/transcribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'audio/wav' },
          body: clip.wav,
        });
        const d = (await res.json().catch(() => null)) as
          | { text?: string; translation?: string; language?: string; error?: string }
          | null;
        // A key/config failure means every burst will fail the same way — flip auto-transcription
        // off after the first one so we don't spam Gemini or clutter the log. Playback still works.
        if (d?.error && /not-configured|gemini_http_(400|401|403)|Forbidden/.test(d.error)) {
          transcribeOffRef.current = true;
          setTranscribeOff(true);
        }
        transcript = d?.text ?? '';
        translation = d?.translation ?? '';
        language = d?.language ?? '';
        failed = !d || Boolean(d.error);
      } catch {
        failed = true;
      }
      setLog((cur) =>
        cur.map((e) =>
          e.id === clip.id ? { ...e, transcribing: false, transcript, translation, transcriptError: failed } : e,
        ),
      );
      void saveActivity(cfg, {
        kind: 'voice',
        from: clip.from,
        direction: 'in',
        transcript: transcript || undefined,
        translation: translation || undefined,
        language: language || undefined,
        durationMs: clip.durationMs,
        at: clip.at,
        audio: clip.wav,
      });
    },
    [saveActivity],
  );

  const saveLocation = useCallback(async (cfg: ZelloConfig, loc: ZelloLocation) => {
    if (!cfg.channel) return;
    try {
      await fetch('/api/zello/locations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: cfg.network,
          channel: cfg.channel,
          device: loc.from,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          address: loc.address,
          at: loc.at,
        }),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const loadDevices = useCallback(async (cfg: ZelloConfig) => {
    if (!cfg.channel) {
      setDevices([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/zello/locations?network=${encodeURIComponent(cfg.network)}&channel=${encodeURIComponent(cfg.channel)}`,
        { credentials: 'include' },
      );
      const d = (await res.json().catch(() => null)) as { devices?: Record<string, unknown>[] } | null;
      const list: MapDevice[] = (d?.devices ?? [])
        .map((it) => ({
          from: String(it.device ?? ''),
          lat: Number(it.latitude),
          lon: Number(it.longitude),
          accuracy: typeof it.accuracy === 'number' ? it.accuracy : undefined,
          at: new Date(String(it.at)).getTime(),
          address: it.address ? String(it.address) : undefined,
        }))
        .filter((x) => x.from && Number.isFinite(x.lat) && Number.isFinite(x.lon));
      setDevices(list);
    } catch {
      /* ignore */
    }
  }, []);

  /** Channels the configured Zello user may log on to (selected one first). */
  const watchListFor = (cfg: ZelloConfig) =>
    logonChannelList(cfg.channel, memberships[cfg.username.trim().toLowerCase()] ?? []);

  // Keep the channel strip live while the console is open but not connected:
  // a presence-only connection, handed over to the real one on Connect and
  // resumed after Disconnect.
  useEffect(() => {
    const connected = status === 'online' || status === 'connecting' || status === 'authenticating';
    if (connected || !config.network.trim() || !config.username.trim() || !config.password) return;
    const list = logonChannelList(config.channel, memberships[config.username.trim().toLowerCase()] ?? []);
    if (list.length === 0) return;
    const watcher = new ZelloPresenceWatcher(config, list, {
      onPresence: (p) => setPresence((cur) => ({ ...cur, [p.channel]: p })),
      onState: (s) => {
        setPresenceState(s);
        if (s === 'watching') setPresenceNote(null);
      },
      onError: (m) => setPresenceNote(explainZelloError(m, config.username)),
    });
    watcherRef.current = watcher;
    watcher.start();
    return () => {
      watcher.stop();
      if (watcherRef.current === watcher) watcherRef.current = null;
    };
    // presenceAttempt only forces a fresh watcher after a kick.
  }, [status, config, memberships, presenceAttempt]);

  const connectWith = (cfg: ZelloConfig) => {
    if (!cfg.channel.trim()) {
      setShowSettings(true);
      return;
    }
    channelRef.current?.disconnect();
    // Zello allows one session per user and kicks the older one, so the
    // presence watcher must be gone before the real logon goes out.
    const hadWatcher = watcherRef.current !== null;
    watcherRef.current?.stop();
    watcherRef.current = null;
    const ch = new ZelloChannel(cfg, {
      onStatus: (s, d) => {
        setStatus(s);
        setStatusDetail(d ?? null);
      },
      onChannelStatus: ({ online: n, locationsSupported: loc }) => {
        setOnline(n);
        setLocationsSupported(loc);
      },
      onChannelPresence: (p) => setPresence((cur) => ({ ...cur, [p.channel]: p })),
      onTalking: (who) => setTalking(who),
      onLog: (entry) => {
        pushLog(entry);
        if (entry.kind === 'text') {
          void saveActivity(cfg, {
            kind: 'text',
            from: entry.from,
            direction: entry.from === (cfg.username || 'You') ? 'out' : 'in',
            text: entry.text,
            at: entry.at,
          });
        }
      },
      onVoiceClip: (clip) => {
        const url = URL.createObjectURL(clip.wav);
        clipUrlsRef.current.push(url);
        const off = transcribeOffRef.current;
        pushLog({
          id: clip.id,
          kind: 'voice',
          from: clip.from,
          text: '',
          at: clip.at,
          audioUrl: url,
          durationMs: clip.durationMs,
          transcribing: !off,
        });
        if (off) {
          void saveActivity(cfg, { kind: 'voice', from: clip.from, direction: 'in', durationMs: clip.durationMs, at: clip.at, audio: clip.wav });
        } else {
          void transcribeClip(clip, cfg);
        }
      },
      onLocation: (loc) => {
        setDevices((cur) => {
          const next = cur.filter((x) => x.from !== loc.from);
          next.push({ from: loc.from, lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy, at: loc.at, address: loc.address });
          return next;
        });
        void saveLocation(cfg, loc);
      },
      onError: (m) => {
        const text = explainZelloError(m, cfg.username);
        setStatusDetail(text);
        pushLog({ id: `${Date.now()}-${Math.random()}`, kind: 'system', from: 'System', text, at: Date.now() });
      },
    }, { watchChannels: watchListFor(cfg) });
    channelRef.current = ch;
    setLog([]);
    setDevices([]);
    setPresence({});
    setLocationsSupported(null);
    setPresenceNote(null);
    if (hadWatcher) {
      // Let the watcher's socket close on Zello's side first.
      window.setTimeout(() => void ch.connect(), 400);
    } else {
      void ch.connect();
    }
    void loadHistory(cfg);
    void loadDevices(cfg);
  };

  const connect = () => connectWith(config);

  const pickChannel = (name: string) => {
    const next = { ...config, channel: name };
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (name && (status === 'online' || status === 'connecting' || status === 'authenticating')) {
      connectWith(next);
    }
  };

  // Create a channel on the Zello Work network, then adopt it locally. The
  // server re-checks admin rights, so a non-admin reaching this only sees a 403.
  const createChannel = async () => {
    const name = newChannel.trim();
    if (!name || creatingChannel) return;
    setCreatingChannel(true);
    setNewChannelError(null);
    try {
      const res = await fetch('/api/zello/channels', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; name?: string } | null;
      if (!res.ok) {
        setNewChannelError(data?.error ?? 'Could not create the channel.');
        return;
      }
      const created = data?.name ?? name;
      setChannels((cur) => (cur.includes(created) ? cur : [...cur, created].sort()));
      setNewChannel('');
      setShowNewChannel(false);
      pickChannel(created);
    } catch {
      setNewChannelError('Could not reach the server.');
    } finally {
      setCreatingChannel(false);
    }
  };

  const disconnect = () => {
    channelRef.current?.disconnect();
    channelRef.current = null;
    setPresence({});
    setStatus('idle');
    setTalking(null);
    setOnline(0);
    setLocationsSupported(null);
    setTransmitting(false);
    transmittingRef.current = false;
  };

  // Keep device positions current while connected. On a Zello Work network the
  // server returns last-known locations (like the Zello map), so polling shows
  // devices even when they aren't actively transmitting on the channel.
  useEffect(() => {
    if (status !== 'online') return;
    return startVisibleInterval(() => void loadDevices(config), 30_000);
  }, [status, config, loadDevices]);

  const startPtt = useCallback(() => {
    if (status !== 'online' || !voice || transmittingRef.current) return;
    transmittingRef.current = true;
    setTransmitting(true);
    void channelRef.current?.startTalking();
  }, [status, voice]);

  const stopPtt = useCallback(() => {
    if (!transmittingRef.current) return;
    transmittingRef.current = false;
    setTransmitting(false);
    channelRef.current?.stopTalking();
  }, []);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTyping()) {
        e.preventDefault();
        startPtt();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        stopPtt();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [startPtt, stopPtt]);

  const saveSettings = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
    setShowSettings(false);
  };

  const sendText = () => {
    if (!text.trim()) return;
    channelRef.current?.sendText(text);
    setText('');
  };

  const isLive = status === 'online';
  const isConnecting = status === 'connecting' || status === 'authenticating';
  // Zello's count includes this console's own connection, so "others" is one less.
  const othersOn = (p: ChannelPresence) => (p.status === 'online' ? Math.max(0, p.usersOnline - 1) : 0);
  // Channels with someone else on them right now, busiest first.
  const activeChannels = Object.values(presence)
    .filter((p) => othersOn(p) > 0)
    .sort((a, b) => othersOn(b) - othersOn(a) || a.channel.localeCompare(b.channel));
  const meta = STATUS_META[status];
  const someoneElseTalking = talking !== null && !transmitting;
  // Stable A→Z order so the device list rows and the numbered map markers line up.
  const sortedDevices = [...devices].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Radio · Zello</h1>
            <p className="mt-1 text-sm text-gray-500">Dispatch push-to-talk over your Zello channel.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/modules/radio-zello/archive"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Archive
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium">
              <StatusDot
                variant={meta.variant}
                label={meta.label}
                pulse={meta.variant === 'online'}
              />
              <span className={meta.text}>{meta.label}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              aria-label="Settings"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {isLive || isConnecting ? (
              <button type="button" onClick={disconnect} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">
                Disconnect
              </button>
            ) : (
              <button type="button" onClick={connect} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90">
                Connect
              </button>
            )}
          </div>
        </header>

        {status === 'error' && statusDetail && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{statusDetail}</div>
        )}
        {!voice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Live voice needs a Chromium browser (Chrome / Edge). You can still connect to monitor presence and text.
          </div>
        )}

        {(channels.length > 0 || canManage) && (
          <div className="rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="px-1 text-sm font-medium text-gray-600 sm:px-2">Channel</span>
            <div className="relative flex-1">
              <select
                value={config.channel}
                onChange={(e) => pickChannel(e.target.value)}
                className="w-full appearance-none rounded-xl bg-gray-50 px-3.5 py-2.5 pr-10 text-sm font-medium text-gray-900 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Select a channel…</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                    {presence[c] ? ` · ${othersOn(presence[c])} online` : ''}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {isLive && config.channel && (
              <span className="px-1 text-xs font-medium text-emerald-600 sm:px-2">switch live</span>
            )}
            <span className="px-1 text-xs text-gray-400 sm:px-2">
              {activeChannels.length > 0
                ? `${activeChannels.length} of ${channels.length} channels active`
                : `${channels.length} channels`}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setShowNewChannel((v) => !v);
                  setNewChannelError(null);
                }}
                className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {showNewChannel ? 'Cancel' : 'New channel'}
              </button>
            )}
          </div>

          {Object.keys(presence).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
              {[...activeChannels, ...Object.values(presence).filter((p) => othersOn(p) === 0).sort((a, b) => a.channel.localeCompare(b.channel))].map((p) => {
                const selected = p.channel === config.channel;
                const others = othersOn(p);
                const busy = others > 0;
                return (
                  <button
                    key={p.channel}
                    type="button"
                    onClick={() => pickChannel(p.channel)}
                    title={p.status === 'offline' ? 'Channel offline' : `${others} other${others === 1 ? '' : 's'} online`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      selected
                        ? 'border-primary bg-primary text-white'
                        : busy
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'bg-emerald-500' : p.status === 'offline' ? 'bg-rose-400' : 'bg-gray-300'}`} />
                    <span className="max-w-[10rem] truncate">{p.channel}</span>
                    <span className={`tabular-nums ${selected ? 'text-white/80' : 'text-gray-400'}`}>{others}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!isLive && (presenceNote || presenceState !== 'stopped') && (
            <p className={`mt-2 px-1 text-xs ${presenceNote ? 'text-rose-600' : 'text-gray-400'}`}>
              {presenceNote ? (
                <>
                  Live presence paused: {presenceNote}{' '}
                  <button type="button" onClick={() => { setPresenceNote(null); setPresenceAttempt((n) => n + 1); }} className="font-semibold text-primary hover:underline">
                    Retry
                  </button>
                </>
              ) : presenceState === 'watching'
                  ? 'Live presence while disconnected — counts update as people join and leave.'
                  : presenceState === 'retrying'
                    ? 'Live presence reconnecting…'
                    : 'Checking who is on the channels…'}
            </p>
          )}

          {canManage && showNewChannel && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={newChannel}
                  autoFocus
                  placeholder="Channel name"
                  maxLength={40}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createChannel();
                    if (e.key === 'Escape') setShowNewChannel(false);
                  }}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void createChannel()}
                  disabled={!newChannel.trim() || creatingChannel}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 sm:w-auto"
                >
                  {creatingChannel ? 'Creating…' : 'Create'}
                </button>
              </div>
              {newChannelError ? (
                <p className="mt-2 px-1 text-xs text-rose-600">{newChannelError}</p>
              ) : (
                <p className="mt-2 px-1 text-xs text-gray-400">
                  Creates the channel on your Zello Work network. Letters, numbers, spaces, dots,
                  hyphens and underscores.
                </p>
              )}
            </div>
          )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-500">Channel</p>
                  <p className="text-base font-bold text-gray-900">{config.channel || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-gray-500">Online</p>
                  <p className="text-base font-bold text-gray-900">{isLive ? online : '—'}</p>
                </div>
              </div>

              <div
                className={`mt-4 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                  someoneElseTalking ? 'bg-rose-50 text-rose-700' : transmitting ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-400'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${someoneElseTalking ? 'bg-rose-500 animate-pulse' : transmitting ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                {someoneElseTalking ? `${talking} is talking` : transmitting ? 'You are transmitting' : 'Channel clear'}
              </div>

              <div className="mt-6 flex flex-col items-center">
                <button
                  type="button"
                  disabled={!isLive || !voice}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startPtt();
                  }}
                  onPointerUp={stopPtt}
                  onPointerLeave={stopPtt}
                  onPointerCancel={stopPtt}
                  className={`flex h-40 w-40 select-none flex-col items-center justify-center rounded-full text-center shadow-lg transition-all ${
                    !isLive || !voice
                      ? 'cursor-not-allowed bg-gray-100 text-gray-400 shadow-none'
                      : transmitting
                        ? 'scale-95 bg-emerald-600 text-white shadow-emerald-200'
                        : 'bg-primary text-white shadow-primary/20 hover:bg-primary/90 active:scale-95'
                  }`}
                >
                  <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-14 0m7 7v3m-4 0h8M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z" />
                  </svg>
                  <span className="mt-2 text-sm font-bold uppercase tracking-wider">{transmitting ? 'On air' : 'Push to talk'}</span>
                </button>
                <p className="mt-4 text-center text-xs text-gray-400">
                  Hold the button or the <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px]">Space</kbd> bar to talk.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="flex h-full flex-col rounded-2xl border border-gray-100 bg-white">
              <div className="border-b border-gray-100 px-5 py-3">
                <p className="text-sm font-semibold text-gray-900">Channel traffic</p>
                {transcribeOff && (
                  <p className="mt-0.5 text-xs text-amber-600">Auto-transcription is off — add a valid GEMINI_API_KEY to enable transcripts. Playback still works.</p>
                )}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4" style={{ maxHeight: '22rem' }}>
                {log.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-400">{isLive ? 'Waiting for activity…' : 'Connect to see voice & text traffic.'}</p>
                ) : (
                  log.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 w-16 shrink-0 text-xs tabular-nums text-gray-400">{timeOf(entry.at)}</span>
                      <span
                        className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          entry.kind === 'voice' ? 'bg-primary/10 text-primary' : entry.kind === 'text' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {entry.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold text-gray-900">{entry.from}</span>
                          {entry.audioUrl ? (
                            <ClipPlayer url={entry.audioUrl} durationMs={entry.durationMs} />
                          ) : entry.kind === 'voice' ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400">
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              {entry.durationMs ? `${Math.max(1, Math.round(entry.durationMs / 1000))}s` : 'voice'}
                            </span>
                          ) : entry.text ? (
                            <span className="text-gray-600">{entry.text}</span>
                          ) : null}
                        </div>
                        {entry.kind === 'voice' && (entry.audioUrl || entry.transcript || entry.transcribing) && (
                          <div className="mt-1">
                            {entry.transcribing ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/40" />
                                Transcribing…
                              </span>
                            ) : entry.transcript ? (
                              <>
                                <p className="text-gray-700">{entry.transcript}</p>
                                {entry.translation && (
                                  <p className="mt-0.5 text-xs text-gray-500">
                                    <span className="font-semibold text-primary/70">EN</span> {entry.translation}
                                  </p>
                                )}
                              </>
                            ) : !entry.audioUrl ? null : transcribeOff ? null : entry.transcriptError ? (
                              <span className="text-xs text-gray-300">Transcript unavailable</span>
                            ) : (
                              <span className="text-xs text-gray-300">No speech detected</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-gray-100 p-3">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendText();
                  }}
                  placeholder={isLive ? 'Send a text message to the channel…' : 'Connect to send messages'}
                  disabled={!isLive}
                  className={inputClass}
                />
                <button type="button" onClick={sendText} disabled={!isLive || !text.trim()} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Device tracking</p>
              <p className="text-xs text-gray-500">Live positions of every device sharing location on this network.</p>
            </div>
            <div className="flex items-center gap-2">
              {devices.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFitNonce((n) => n + 1)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  title="Zoom out to show every device"
                >
                  Fit all
                </button>
              )}
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {devices.length} {devices.length === 1 ? 'device' : 'devices'}
              </span>
            </div>
          </div>
          {isLive && locationsSupported === false && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This channel doesn’t have location sharing enabled, so no device positions will appear. In the Zello Work
              admin console, turn on location reporting for the channel and its users.
            </div>
          )}
          {isLive && locationsSupported && devices.length === 0 && (
            <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
              Location sharing is enabled, but no device has reported a position yet. Devices appear here once they share
              their location from the Zello app.
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
            <DeviceList devices={sortedDevices} onFocus={(from) => setMapFocus((p) => ({ from, n: (p?.n ?? 0) + 1 }))} />
            <ZelloMap devices={sortedDevices} focus={mapFocus} fitNonce={fitNonce} />
          </div>
        </div>
      </div>

      {showSettings && (
        <>
          <div className="fixed inset-0 z-[220] bg-gray-900/30 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="fixed right-0 top-0 z-[230] flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">Zello connection</h2>
              <button type="button" onClick={() => setShowSettings(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 space-y-4 px-6 py-6">
              <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
                For a Zello Work network just set the <strong>network</strong>, <strong>channel</strong>, and a <strong>username/password</strong> — no token needed. Stored only in this browser.
              </p>
              <div>
                <label className={labelClass}>Zello Work network</label>
                <input type="text" value={config.network} placeholder="ladyaskari (blank = consumer zello.io)" onChange={(e) => setConfig({ ...config, network: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Channel</label>
                <input type="text" value={config.channel} onChange={(e) => setConfig({ ...config, channel: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Username</label>
                  <input type="text" value={config.username} onChange={(e) => setConfig({ ...config, username: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input type="password" value={config.password} onChange={(e) => setConfig({ ...config, password: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Auth token (consumer Zello only)</label>
                <textarea rows={2} value={config.authToken} placeholder="Leave blank for Zello Work" onChange={(e) => setConfig({ ...config, authToken: e.target.value })} className={`${inputClass} font-mono text-xs`} />
              </div>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-gray-100 bg-white px-6 py-4">
              <button type="button" onClick={() => setShowSettings(false)} className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={saveSettings} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90">
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Green = reported within 5 min, amber = within an hour, grey = older.
function freshnessDot(at: number): string {
  const min = (Date.now() - at) / 60000;
  if (min <= 5) return 'bg-emerald-500';
  if (min <= 60) return 'bg-amber-500';
  return 'bg-gray-300';
}

/** Roster of devices sharing location; click a row to focus that device on the map. */
function DeviceList({ devices, onFocus }: { devices: MapDevice[]; onFocus: (from: string) => void }) {
  if (devices.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 p-3 text-center text-xs text-gray-400 lg:h-80">
        No devices sharing location yet.
      </div>
    );
  }
  return (
    <div className="divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100 lg:h-80">
      {devices.map((d, i) => (
        <button
          key={d.from}
          type="button"
          onClick={() => onFocus(d.from)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
          title="Show on map"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-900">{d.from}</span>
            <span className="block truncate text-[11px] text-gray-400">
              {timeAgo(d.at)}
              {d.accuracy ? ` · ±${Math.round(d.accuracy)}m` : ''}
            </span>
          </span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${freshnessDot(d.at)}`} aria-hidden />
        </button>
      ))}
    </div>
  );
}
