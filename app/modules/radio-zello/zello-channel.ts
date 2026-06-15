'use client';

/**
 * Minimal Zello Channels API client for the dispatch console.
 *
 * Protocol reference: https://github.com/zelloptt/zello-channel-api
 * - JSON commands over a WebSocket, binary frames for audio.
 * - Audio is raw Opus; we use WebCodecs (AudioEncoder/AudioDecoder) to encode the
 *   mic and decode incoming streams, then play through an AudioContext.
 *
 * Voice requires a WebCodecs-capable browser (Chrome / Edge). The signalling,
 * presence and text paths work anywhere.
 */

export type ZelloStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'online'
  | 'error'
  | 'closed';

export interface ZelloConfig {
  network: string; // Zello Work network; empty = consumer zello.io
  channel: string;
  username: string;
  password: string;
  authToken: string; // optional manual token (overrides the server-issued one)
}

export interface ZelloLogEntry {
  id: string;
  kind: 'voice' | 'text' | 'system';
  from: string;
  text: string;
  at: number;
}

/** A finished incoming transmission, captured for replay and transcription. */
export interface ZelloVoiceClip {
  id: string;
  from: string;
  at: number; // when the transmission started (ms epoch)
  durationMs: number;
  wav: Blob; // 16-bit PCM mono WAV
}

/** A device location report (Zello `on_location`), for the tracking map. */
export interface ZelloLocation {
  from: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  at: number;
}

export interface ZelloHandlers {
  onStatus?: (status: ZelloStatus, detail?: string) => void;
  onChannelStatus?: (info: { online: number; locationsSupported: boolean }) => void;
  onTalking?: (username: string | null) => void;
  onLog?: (entry: ZelloLogEntry) => void;
  onVoiceClip?: (clip: ZelloVoiceClip) => void;
  onLocation?: (location: ZelloLocation) => void;
  onError?: (message: string) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyAudioDecoder = any;
type AnyAudioEncoder = any;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Encode mono Float32 PCM into a 16-bit WAV blob (what we hand to playback / Gemini). */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Downsample mono Float32 PCM by window-averaging — anti-aliased enough for speech. */
function downsample(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (dstRate >= srcRate || srcRate <= 0) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

export function hasVoiceSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    'AudioEncoder' in window &&
    'AudioDecoder' in window &&
    'MediaStreamTrackProcessor' in window
  );
}

/** Stored & transcribed audio is downsampled to this rate — ample for speech, ~1/3 the bytes. */
const STORE_RATE = 16000;

/** Playback look-ahead (seconds) — a small cushion so network jitter doesn't underrun. */
const PLAYBACK_JITTER = 0.1;

export class ZelloChannel {
  private ws: WebSocket | null = null;
  private seq = 0;
  private config: ZelloConfig;
  private handlers: ZelloHandlers;
  private status: ZelloStatus = 'idle';

  // playback
  private audioCtx: AudioContext | null = null;
  private playbackCursor = 0; // one shared timeline for all streams, so transmissions never overlap
  private decoders = new Map<
    number,
    {
      decoder: AnyAudioDecoder;
      nextTime: number;
      from: string;
      captureRate: number;
      startedAt: number;
      chunks: Float32Array[];
      frames: number;
    }
  >();

  // capture / transmit
  private micStream: MediaStream | null = null;
  private encoder: AnyAudioEncoder | null = null;
  private abort: AbortController | null = null;
  private outStreamId: number | null = null;
  private outPacketId = 0;
  private sendSampleRate = 0;

  constructor(config: ZelloConfig, handlers: ZelloHandlers) {
    this.config = config;
    this.handlers = handlers;
  }

  private setStatus(status: ZelloStatus, detail?: string) {
    this.status = status;
    this.handlers.onStatus?.(status, detail);
  }

  private log(kind: ZelloLogEntry['kind'], from: string, text: string) {
    this.handlers.onLog?.({ id: makeId(), kind, from, text, at: Date.now() });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private wsUrl(): string {
    const net = this.config.network.trim();
    // Zello Work: wss://zellowork.io/ws/<network>. Consumer Zello: wss://zello.io/ws.
    return net ? `wss://zellowork.io/ws/${encodeURIComponent(net)}` : 'wss://zello.io/ws';
  }

  async connect(): Promise<void> {
    if (this.ws) this.disconnect();
    this.setStatus('connecting');
    try {
      const ws = new WebSocket(this.wsUrl());
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => void this.logon();
      ws.onmessage = (e) => this.onMessage(e);
      ws.onerror = () => this.handlers.onError?.('WebSocket connection error');
      ws.onclose = () => {
        if (this.status !== 'error') this.setStatus('closed');
      };
    } catch {
      this.setStatus('error', 'Could not open WebSocket');
    }
  }

  private async logon(): Promise<void> {
    this.setStatus('authenticating');
    const isWork = this.config.network.trim().length > 0;

    const cmd: Record<string, unknown> = {
      command: 'logon',
      seq: this.nextSeq(),
      channel: this.config.channel,
    };

    if (isWork) {
      // Zello Work authenticates with username + password + channels (no token).
      cmd.channels = [this.config.channel];
      if (this.config.username.trim()) cmd.username = this.config.username.trim();
      if (this.config.password) cmd.password = this.config.password;
    } else {
      // Consumer Zello requires a developer auth token.
      let token = this.config.authToken.trim();
      if (!token) {
        try {
          const r = await fetch('/api/zello/token', { credentials: 'include' });
          const d = (await r.json().catch(() => null)) as { token?: string | null } | null;
          if (d?.token) token = d.token;
        } catch {
          /* fall through to username/password */
        }
      }
      if (token) cmd.auth_token = token;
      if (this.config.username.trim()) cmd.username = this.config.username.trim();
      if (this.config.password) cmd.password = this.config.password;
    }

    this.sendJson(cmd);
  }

  private sendJson(obj: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(obj));
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleJson(msg);
    } else if (event.data instanceof ArrayBuffer) {
      this.handleBinary(new Uint8Array(event.data));
    }
  }

  private handleJson(msg: Record<string, unknown>): void {
    const command = msg.command as string | undefined;

    if (command === 'on_channel_status') {
      const online = Number(msg.users_online ?? 0);
      this.setStatus('online');
      this.handlers.onChannelStatus?.({ online, locationsSupported: msg.locations_supported === true });
      return;
    }
    if (command === 'on_stream_start') {
      this.startDecoder(msg);
      // The live "talking now" indicator covers the start; the finished clip is
      // logged on stop (with replay + transcript) so there's one entry per burst.
      this.handlers.onTalking?.(String(msg.from ?? 'Someone'));
      return;
    }
    if (command === 'on_stream_stop') {
      this.stopDecoder(Number(msg.stream_id));
      this.handlers.onTalking?.(null);
      return;
    }
    if (command === 'on_text_message') {
      this.log('text', String(msg.from ?? ''), String(msg.text ?? ''));
      return;
    }
    if (command === 'on_location') {
      const lat = Number(msg.latitude);
      const lon = Number(msg.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const accuracy = Number(msg.accuracy);
        // on_location carries no timestamp field — stamp it on arrival.
        const ts = Number(msg.timestamp);
        this.handlers.onLocation?.({
          from: String(msg.from ?? 'Unknown'),
          latitude: lat,
          longitude: lon,
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
          address: msg.formatted_address ? String(msg.formatted_address) : undefined,
          at: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        });
      }
      return;
    }
    if (command === 'on_error' || msg.error) {
      const err = String(msg.error ?? 'Zello error');
      this.handlers.onError?.(err);
      this.setStatus('error', err);
      return;
    }

    // Reply to our own commands (logon ack, start_stream ack…)
    if (msg.success === true && this.outStreamPending && typeof msg.stream_id === 'number') {
      this.outStreamId = msg.stream_id as number;
      this.outStreamPending = false;
    }
    if (msg.error && msg.success === false) {
      this.handlers.onError?.(String(msg.error));
    }
  }

  // ---- Incoming audio (playback) ----

  private getAudioCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  private startDecoder(msg: Record<string, unknown>): void {
    const streamId = Number(msg.stream_id);
    if (!hasVoiceSupport() || Number.isNaN(streamId)) return;
    let sampleRate = 16000;
    try {
      const header = atob(String(msg.codec_header ?? ''));
      if (header.length >= 2) sampleRate = header.charCodeAt(0) | (header.charCodeAt(1) << 8);
    } catch {
      /* default 16000 */
    }
    const ctx = this.getAudioCtx();
    const AudioDecoderCtor = (window as any).AudioDecoder;
    const entry = {
      decoder: null as AnyAudioDecoder,
      nextTime: 0,
      from: String(msg.from ?? 'Someone'),
      captureRate: sampleRate,
      startedAt: Date.now(),
      chunks: [] as Float32Array[],
      frames: 0,
    };
    const decoder: AnyAudioDecoder = new AudioDecoderCtor({
      output: (data: any) => {
        try {
          const frames = data.numberOfFrames as number;
          // Trust the decoder's own output rate for both playback and capture —
          // mismatching it is what makes voices sound sped-up / robotic.
          const rate = (data.sampleRate as number) || 48000;
          entry.captureRate = rate;
          const channels = (data.numberOfChannels as number) || 1;
          const pcm = new Float32Array(frames * channels);
          data.copyTo(pcm, { planeIndex: 0, format: 'f32' });
          const mono = channels > 1 ? pcm.filter((_, i) => i % channels === 0) : pcm;
          const buffer = ctx.createBuffer(1, frames, rate);
          buffer.copyToChannel(mono, 0);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          // Schedule onto ONE channel-wide timeline. PTT is sequential, so a new
          // transmission must continue after the previous one's tail rather than
          // overlap it — overlapping queued audio is what sounds like an echo.
          // If we've drained the buffer (gap in traffic), resync with a small cushion.
          if (this.playbackCursor < ctx.currentTime + 0.02) {
            this.playbackCursor = ctx.currentTime + PLAYBACK_JITTER;
          }
          const startAt = this.playbackCursor;
          src.start(startAt);
          this.playbackCursor = startAt + buffer.duration;
          // Keep a copy for replay + transcription (cap ~5 min of audio).
          if (entry.frames < entry.captureRate * 300) {
            entry.chunks.push(mono);
            entry.frames += mono.length;
          }
          data.close?.();
        } catch {
          /* drop frame */
        }
      },
      error: () => {},
    });
    try {
      // Opus's canonical rate is 48 kHz; configuring the decoder here (rather than at
      // the header's nominal rate, e.g. 16 kHz) is the reliable way to get correct-pitch
      // PCM out of WebCodecs. The header rate is kept only as a capture fallback.
      decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
    } catch {
      return;
    }
    entry.decoder = decoder;
    this.decoders.set(streamId, entry);
  }

  private stopDecoder(streamId: number): void {
    const entry = this.decoders.get(streamId);
    if (!entry) return;
    try {
      entry.decoder.close?.();
    } catch {
      /* ignore */
    }
    this.decoders.delete(streamId);
    // Flush the captured audio into a replayable / transcribable clip.
    // Skip sub-0.3s blips (clicks, accidental key taps).
    if (this.handlers.onVoiceClip && entry.frames > entry.captureRate * 0.3) {
      try {
        const pcm = downsample(concatFloat32(entry.chunks, entry.frames), entry.captureRate, STORE_RATE);
        const wav = encodeWav(pcm, STORE_RATE);
        this.handlers.onVoiceClip({
          id: makeId(),
          from: entry.from,
          at: entry.startedAt,
          durationMs: Math.round((entry.frames / entry.captureRate) * 1000),
          wav,
        });
      } catch {
        /* ignore */
      }
    }
  }

  private handleBinary(bytes: Uint8Array): void {
    if (bytes.length < 9 || bytes[0] !== 1) return; // 1 = audio packet
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const streamId = view.getUint32(1, false);
    const entry = this.decoders.get(streamId);
    if (!entry) return;
    const payload = bytes.subarray(9);
    try {
      const EncodedAudioChunkCtor = (window as any).EncodedAudioChunk;
      const chunk = new EncodedAudioChunkCtor({ type: 'key', timestamp: 0, data: payload });
      entry.decoder.decode(chunk);
    } catch {
      /* drop */
    }
  }

  // ---- Outgoing audio (push to talk) ----

  private outStreamPending = false;

  async startTalking(): Promise<void> {
    if (!hasVoiceSupport()) {
      this.handlers.onError?.('Voice needs Chrome or Edge (WebCodecs).');
      return;
    }
    if (this.outStreamId !== null || this.outStreamPending) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.handlers.onError?.('Microphone permission denied.');
      return;
    }
    const track = this.micStream.getAudioTracks()[0];
    const settings = track.getSettings();
    const sampleRate = settings.sampleRate ?? 48000;
    this.sendSampleRate = sampleRate;
    this.outPacketId = 0;

    // Announce the stream; the server replies with a stream_id.
    const header = new Uint8Array([sampleRate & 0xff, (sampleRate >> 8) & 0xff, 1, 60]);
    this.outStreamPending = true;
    this.sendJson({
      command: 'start_stream',
      seq: this.nextSeq(),
      type: 'audio',
      codec: 'opus',
      codec_header: btoa(String.fromCharCode(...header)),
      packet_duration: 60,
    });

    const AudioEncoderCtor = (window as any).AudioEncoder;
    this.encoder = new AudioEncoderCtor({
      output: (chunk: any) => this.sendAudioChunk(chunk),
      error: () => {},
    });
    try {
      this.encoder.configure({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: 24000 });
    } catch {
      this.handlers.onError?.('Could not start the Opus encoder.');
      this.stopTalking();
      return;
    }

    this.abort = new AbortController();
    const Processor = (window as any).MediaStreamTrackProcessor;
    const processor = new Processor({ track });
    const reader = processor.readable.getReader();
    const pump = async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.abort?.signal.aborted) break;
          try {
            this.encoder?.encode(value);
          } finally {
            value.close?.();
          }
        }
      } catch {
        /* stopped */
      }
    };
    void pump();
    this.log('voice', this.config.username || 'You', 'transmitting…');
  }

  private sendAudioChunk(chunk: any): void {
    if (this.outStreamId === null || !this.ws) return;
    const size = chunk.byteLength as number;
    const payload = new Uint8Array(size);
    chunk.copyTo(payload);
    const packet = new Uint8Array(9 + size);
    const view = new DataView(packet.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, this.outStreamId, false);
    view.setUint32(5, this.outPacketId, false);
    this.outPacketId += 1;
    packet.set(payload, 9);
    this.ws.send(packet);
  }

  stopTalking(): void {
    this.abort?.abort();
    this.abort = null;
    try {
      this.encoder?.close?.();
    } catch {
      /* ignore */
    }
    this.encoder = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.outStreamId !== null) {
      this.sendJson({ command: 'stop_stream', seq: this.nextSeq(), stream_id: this.outStreamId });
    }
    this.outStreamId = null;
    this.outStreamPending = false;
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.ws) return;
    this.sendJson({ command: 'send_text_message', seq: this.nextSeq(), text: trimmed });
    this.log('text', this.config.username || 'You', trimmed);
  }

  disconnect(): void {
    this.stopTalking();
    for (const id of Array.from(this.decoders.keys())) this.stopDecoder(id);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    if (this.audioCtx && this.audioCtx.state !== 'closed') void this.audioCtx.close();
    this.audioCtx = null;
    this.playbackCursor = 0;
    this.setStatus('idle');
  }
}
