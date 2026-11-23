export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' Here is the code example shown on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordered strictly by consistent US English neutral assistant voices first,
// then deterministic regional fallbacks ONLY if the primary accent family is absent.
const CONSISTENT_VOICE_PRIORITY: Array<{ hint: string; langPrefix: string }> = [
  { hint: 'microsoft aria online', langPrefix: 'en-us' },
  { hint: 'microsoft jenny online', langPrefix: 'en-us' },
  { hint: 'microsoft ava online', langPrefix: 'en-us' },
  { hint: 'samantha', langPrefix: 'en-us' },
  { hint: 'allison', langPrefix: 'en-us' },
  { hint: 'ava', langPrefix: 'en-us' },
  { hint: 'microsoft zira', langPrefix: 'en-us' },
  { hint: 'google us english', langPrefix: 'en-us' },
  { hint: 'google uk english female', langPrefix: 'en-gb' },
  { hint: 'microsoft hazel', langPrefix: 'en-gb' },
  { hint: 'serena', langPrefix: 'en-gb' },
  { hint: 'kate', langPrefix: 'en-gb' },
  { hint: 'karen', langPrefix: 'en-au' },
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

let cachedVoicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * Waits for browser SpeechSynthesis voices to finish asynchronous initialization
 * so message #1 never uses a different voice/accent from message #2.
 */
export function ensureVoicesLoaded(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    return Promise.resolve(existing);
  }

  if (cachedVoicesPromise) {
    return cachedVoicesPromise;
  }

  cachedVoicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      window.clearTimeout(timer);
      const list = window.speechSynthesis.getVoices();
      if (list.length === 0) {
        cachedVoicesPromise = null;
      }
      resolve(list);
    };

    const onVoicesChanged = () => {
      if (window.speechSynthesis.getVoices().length > 0) {
        finish();
      }
    };

    const timer = window.setTimeout(finish, timeoutMs);
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
  });

  return cachedVoicesPromise;
}

function normalizeLang(lang?: string): string {
  return (lang || '').trim().toLowerCase();
}

export function selectBestFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const sorted = [...voices].sort((a, b) => a.voiceURI.localeCompare(b.voiceURI));
  const enUs = sorted.filter((v) => normalizeLang(v.lang).startsWith('en-us'));
  const english = sorted.filter((v) => normalizeLang(v.lang).startsWith('en'));
  const pool = enUs.length > 0 ? enUs : english.length > 0 ? english : sorted;

  for (const { hint, langPrefix } of CONSISTENT_VOICE_PRIORITY) {
    const match = pool.find(
      (v) =>
        v.name.toLowerCase().includes(hint) &&
        normalizeLang(v.lang).startsWith(langPrefix)
    );
    if (match) return match;
  }

  const nonMale = pool.find((v) => {
    const lower = v.name.toLowerCase();
    return !MALE_VOICE_HINTS.some((m) => lower.includes(m));
  });

  return nonMale || pool[0] || null;
}

/**
 * Resolves the exact persisted voiceURI whenever available.
 * If the exact URI is unavailable (e.g. different browser), stays locked within the
 * same language/accent family instead of silently switching accents.
 */
export function resolveConsistentVoice(
  voices: SpeechSynthesisVoice[],
  lockedVoiceURI?: string,
  lockedVoiceLang?: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  if (lockedVoiceURI) {
    const exact = voices.find((v) => v.voiceURI === lockedVoiceURI);
    if (exact) return exact;
  }

  const targetLang = normalizeLang(lockedVoiceLang);
  if (targetLang) {
    const sameLocale = voices.filter((v) => normalizeLang(v.lang) === targetLang);
    if (sameLocale.length > 0) {
      return selectBestFemaleVoice(sameLocale);
    }
    const baseLang = targetLang.split('-')[0];
    if (baseLang) {
      const sameFamily = voices.filter((v) =>
        normalizeLang(v.lang).startsWith(baseLang)
      );
      if (sameFamily.length > 0) {
        return selectBestFemaleVoice(sameFamily);
      }
    }
  }

  return selectBestFemaleVoice(voices);
}

export interface VoiceOptionItem {
  voiceURI: string;
  name: string;
  lang: string;
}

export function listAvailableVoices(voices: SpeechSynthesisVoice[]): VoiceOptionItem[] {
  if (!voices || voices.length === 0) return [];
  const english = voices.filter((v) => normalizeLang(v.lang).startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  const seen = new Set<string>();
  const items: VoiceOptionItem[] = [];

  for (const v of pool) {
    if (seen.has(v.voiceURI)) continue;
    seen.add(v.voiceURI);
    items.push({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang || 'en-US',
    });
  }

  return items.sort((a, b) => {
    const aUs = a.lang.toLowerCase().startsWith('en-us') ? 0 : 1;
    const bUs = b.lang.toLowerCase().startsWith('en-us') ? 0 : 1;
    if (aUs !== bUs) return aUs - bUs;
    return a.name.localeCompare(b.name);
  });
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

function parseRetryAfter(res: Response, bodySeconds?: unknown): number | undefined {
  if (typeof bodySeconds === 'number' && Number.isFinite(bodySeconds) && bodySeconds > 0) {
    return Math.min(20, Math.ceil(bodySeconds));
  }
  const headerVal = res.headers.get('Retry-After');
  if (headerVal) {
    const num = Number(headerVal);
    if (Number.isFinite(num) && num > 0) {
      return Math.min(20, Math.ceil(num));
    }
  }
  return undefined;
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
      error: `Studio voice is cooling down (~${cooldownSec}s).`,
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
      const retryAfterSeconds = parseRetryAfter(res, payload?.retryAfterSeconds);
      ttsCooldownUntil = Date.now() + (retryAfterSeconds ?? 300) * 1000;
      return {
        buffer: null,
        rateLimited: true,
        retryAfterSeconds,
        error: payload?.error || 'Studio voice quota reached.',
      };
    }

    if (!res.ok) {
      return {
        buffer: null,
        rateLimited: false,
        error: payload?.error || `Studio voice unavailable (${res.status}).`,
      };
    }

    if (!payload?.audioBase64) {
      return {
        buffer: null,
        rateLimited: false,
        error: 'Studio voice returned empty audio.',
      };
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
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === 'AbortError' && signal?.aborted) {
      return { buffer: null, rateLimited: false };
    }
    return {
      buffer: null,
      rateLimited: false,
      error: 'Unable to reach Studio voice right now.',
    };
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
      const retryAfterSeconds = parseRetryAfter(res, payload.retryAfterSeconds);
      transcribeCooldownUntil = Date.now() + (retryAfterSeconds ?? 60) * 1000;
      return {
        transcript: '',
        rateLimited: true,
        retryAfterSeconds,
        error:
          payload.error ||
          'Voice transcription quota reached. Switch to Browser Voice or type your message below.',
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
