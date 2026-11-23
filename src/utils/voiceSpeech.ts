export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' Here is the code example shown on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FEMALE_VOICE_PRIORITY = [
  'google uk english female',
  'microsoft aria online',
  'microsoft jenny online',
  'microsoft ava online',
  'samantha',
  'karen',
  'victoria',
  'tessa',
  'moira',
  'fiona',
  'allison',
  'ava',
  'serena',
  'kate',
  'microsoft zira',
  'microsoft hazel',
  'microsoft susan',
  'google us english',
  'female',
];

const MALE_VOICE_HINTS = [
  'daniel',
  'alex',
  'fred',
  'jorge',
  'thomas',
  'oliver',
  'arthur',
  'rishi',
  'microsoft david',
  'microsoft mark',
  'microsoft george',
  'microsoft ryan',
  'google uk english male',
  'male',
];

export function selectBestFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  for (const hint of FEMALE_VOICE_PRIORITY) {
    const match = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }

  const nonMale = pool.find((v) => {
    const lower = v.name.toLowerCase();
    return !MALE_VOICE_HINTS.some((m) => lower.includes(m));
  });

  return nonMale || pool[0] || null;
}

let sharedAudioCtx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      sharedAudioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Call synchronously inside user click/tap handlers so mobile Safari,
 * Android Chrome, and strict desktop browsers unlock Web Audio playback.
 */
export function unlockAudioContext(): AudioContext | null {
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

function createTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

export type SynthesizedSpeechResult =
  | {
      buffer: ArrayBuffer;
      mimeType: string;
      rateLimited?: false;
    }
  | {
      buffer: null;
      rateLimited: boolean;
      retryAfterSeconds?: number;
      error?: string;
    };

export interface TranscribeResult {
  transcript: string;
  error?: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

const MAX_CLIENT_TTS_CACHE = 12;
const clientTtsCache = new Map<string, { buffer: ArrayBuffer; mimeType: string }>();
let ttsCooldownUntil = 0;
let transcribeCooldownUntil = 0;

export function getTtsCooldownSeconds(): number {
  const remaining = Math.ceil((ttsCooldownUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function getTranscribeCooldownSeconds(): number {
  const remaining = Math.ceil((transcribeCooldownUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

function parseRetryAfter(res: Response, bodySeconds?: unknown, fallbackSeconds = 60): number {
  if (typeof bodySeconds === 'number' && Number.isFinite(bodySeconds) && bodySeconds > 0) {
    return Math.min(300, Math.ceil(bodySeconds));
  }
  const headerVal = res.headers.get('Retry-After');
  if (headerVal) {
    const num = Number(headerVal);
    if (Number.isFinite(num) && num > 0) {
      return Math.min(300, Math.ceil(num));
    }
  }
  return fallbackSeconds;
}

export async function synthesizeGeminiSpeech(
  text: string,
  signal?: AbortSignal
): Promise<SynthesizedSpeechResult> {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    return { buffer: null, rateLimited: false };
  }

  const cached = clientTtsCache.get(cleaned);
  if (cached) {
    return {
      buffer: cached.buffer.slice(0),
      mimeType: cached.mimeType,
    };
  }

  const cooldownSec = getTtsCooldownSeconds();
  if (cooldownSec > 0) {
    return {
      buffer: null,
      rateLimited: true,
      retryAfterSeconds: cooldownSec,
      error: `Cloud voice usage limit reached — using device voice (~${cooldownSec}s cooldown).`,
    };
  }

  const { signal: reqSignal, cleanup } = createTimeoutSignal(8500, signal);

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: reqSignal,
      body: JSON.stringify({ text: cleaned }),
    });

    const payload = (await res.json().catch(() => null)) as {
      audioBase64?: string;
      mimeType?: string;
      code?: string;
      retryAfterSeconds?: number;
      error?: string;
    } | null;

    if (res.status === 429 || payload?.code === 'RATE_LIMITED') {
      const retryAfterSeconds = parseRetryAfter(res, payload?.retryAfterSeconds, 60);
      ttsCooldownUntil = Date.now() + retryAfterSeconds * 1000;
      return {
        buffer: null,
        rateLimited: true,
        retryAfterSeconds,
        error:
          payload?.error ||
          `Cloud voice usage limit reached — using device voice for ~${retryAfterSeconds}s.`,
      };
    }

    if (!res.ok) {
      return {
        buffer: null,
        rateLimited: false,
        error: payload?.error,
      };
    }

    if (!payload?.audioBase64) {
      return { buffer: null, rateLimited: false };
    }

    const binary = atob(payload.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const mimeType = payload.mimeType || 'audio/wav';
    if (clientTtsCache.size >= MAX_CLIENT_TTS_CACHE) {
      const oldestKey = clientTtsCache.keys().next().value;
      if (oldestKey) clientTtsCache.delete(oldestKey);
    }
    clientTtsCache.set(cleaned, { buffer: bytes.buffer.slice(0), mimeType });

    return {
      buffer: bytes.buffer,
      mimeType,
    };
  } catch {
    return { buffer: null, rateLimited: false };
  } finally {
    cleanup();
  }
}

export function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function transcribeAudioBlob(
  blob: Blob,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  const cooldownSec = getTranscribeCooldownSeconds();
  if (cooldownSec > 0) {
    return {
      transcript: '',
      rateLimited: true,
      retryAfterSeconds: cooldownSec,
      error: `Voice usage limit reached. Please wait ${cooldownSec}s, switch to Browser Voice, or type below.`,
    };
  }

  const { signal: reqSignal, cleanup, didTimeout } = createTimeoutSignal(18000, signal);

  try {
    const buffer = await blob.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(buffer);
    const mimeType = (blob.type || 'audio/webm').split(';')[0].trim();

    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: reqSignal,
      body: JSON.stringify({ audioBase64, mimeType }),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      transcript?: string;
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
    };

    if (res.status === 429 || payload.code === 'RATE_LIMITED') {
      const retryAfterSeconds = parseRetryAfter(res, payload.retryAfterSeconds, 45);
      transcribeCooldownUntil = Date.now() + retryAfterSeconds * 1000;
      return {
        transcript: '',
        rateLimited: true,
        retryAfterSeconds,
        error:
          payload.error ||
          `Voice usage limit reached. Please wait ~${retryAfterSeconds}s or type your message below.`,
      };
    }

    if (!res.ok) {
      return {
        transcript: '',
        error: payload.error || `Transcription failed (${res.status}).`,
      };
    }

    return { transcript: (payload.transcript || '').trim() };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (didTimeout()) {
      return {
        transcript: '',
        error: 'Voice transcription timed out. Please try speaking again.',
      };
    }
    if (e?.name === 'AbortError' || signal?.aborted) {
      return { transcript: '' };
    }
    return {
      transcript: '',
      error:
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'You appear to be offline. Check your connection and try again.'
          : 'Unable to reach the voice transcription service.',
    };
  } finally {
    cleanup();
  }
}
