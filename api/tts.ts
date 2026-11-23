import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TTS_CHARS = 1800;
const MAX_CACHE_ITEMS = 24;

// Small in-memory LRU cache to avoid duplicate Gemini TTS API calls for repeated phrases
const ttsCache = new Map<string, { audioBase64: string; mimeType: string }>();
let ttsRateLimitedUntil = 0;

type AugmentedRequest = IncomingMessage & {
  body?: unknown;
};

interface TtsRequestBody {
  text?: unknown;
}

function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY' || key === 'your_gemini_api_key_here') {
    return null;
  }
  return key;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: AugmentedRequest): Promise<TtsRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as TtsRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as TtsRequestBody;
    }
    return null;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as TtsRequestBody);
      } catch {
        resolve(null);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' Here is the code example shown on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

function extractRetrySeconds(rawMessage: string): number {
  const secMatch = /retry(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*s/i.exec(rawMessage);
  if (secMatch) {
    const parsed = Math.ceil(Number(secMatch[1]));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(300, parsed);
    }
  }
  return 60;
}

function isRateLimitError(status: number | undefined, rawMessage: string): boolean {
  return status === 429 || /resource_exhausted|quota|rate\s*limit|too many requests/i.test(rawMessage);
}

export default async function handler(req: AugmentedRequest, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    sendJson(res, 503, {
      code: 'NOT_CONFIGURED',
      error: 'Speech service is not configured. Please set GEMINI_API_KEY in your environment variables.',
    });
    return;
  }

  let body: TtsRequestBody | null = null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request body.' });
    return;
  }

  if (!body || typeof body.text !== 'string') {
    sendJson(res, 400, { error: 'Text is required for speech synthesis.' });
    return;
  }

  const spokenText = cleanTextForSpeech(body.text);
  if (!spokenText) {
    sendJson(res, 400, { error: 'No speakable text provided.' });
    return;
  }

  const cached = ttsCache.get(spokenText);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  const now = Date.now();
  if (now < ttsRateLimitedUntil) {
    const retryAfterSeconds = Math.max(1, Math.ceil((ttsRateLimitedUntil - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendJson(res, 429, {
      code: 'RATE_LIMITED',
      retryAfterSeconds,
      error: `Cloud voice quota limit reached. Using device voice for ~${retryAfterSeconds}s.`,
    });
    return;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const generateAudio = async (withStyle: boolean) => {
      const part: { text: string; speechMetadata?: { style: string } } = {
        text: spokenText,
      };
      if (withStyle) {
        part.speechMetadata = {
          style:
            'Warm, calm, intelligent, friendly conversational female assistant, natural pacing and gentle expressiveness',
        };
      }
      return ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [part],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
    };

    let response;
    try {
      response = await generateAudio(true);
    } catch (firstErr) {
      const firstObj = firstErr as { status?: number; code?: number; message?: string } | null;
      const firstStatus = firstObj?.status || firstObj?.code;
      const firstMsg = String(firstObj?.message || '');
      // Never retry on quota/rate-limit (429) or auth/bad-request errors
      if (
        firstStatus === 400 ||
        firstStatus === 401 ||
        firstStatus === 403 ||
        firstStatus === 404 ||
        isRateLimitError(firstStatus, firstMsg)
      ) {
        throw firstErr;
      }
      await new Promise((r) => setTimeout(r, 350));
      response = await generateAudio(false);
    }

    const parts = response.candidates?.[0]?.content?.parts || [];
    const inlinePart = parts.find((p) => p.inlineData?.data);
    const base64Audio = inlinePart?.inlineData?.data;
    const mimeType = inlinePart?.inlineData?.mimeType || 'audio/wav';

    if (!base64Audio) {
      sendJson(res, 502, {
        code: 'EMPTY_AUDIO',
        error: 'Speech synthesis returned no audio data.',
      });
      return;
    }

    if (ttsCache.size >= MAX_CACHE_ITEMS) {
      const oldestKey = ttsCache.keys().next().value;
      if (oldestKey) ttsCache.delete(oldestKey);
    }
    ttsCache.set(spokenText, { audioBase64: base64Audio, mimeType });

    sendJson(res, 200, {
      audioBase64: base64Audio,
      mimeType,
    });
  } catch (err) {
    const errObj = err as { status?: number; code?: number; message?: string } | null;
    const status = errObj?.status || errObj?.code;
    const rawMsg = String(errObj?.message || '');

    if (isRateLimitError(status, rawMsg)) {
      const retryAfterSeconds = extractRetrySeconds(rawMsg);
      ttsRateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
      console.warn(`[CHORMO AI] Gemini TTS rate limited (${retryAfterSeconds}s cooldown)`);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      sendJson(res, 429, {
        code: 'RATE_LIMITED',
        retryAfterSeconds,
        error: `Cloud voice quota limit reached. Using device voice for ~${retryAfterSeconds}s.`,
      });
      return;
    }

    if (
      status === 401 ||
      status === 403 ||
      /api_key_invalid|permission_denied|api key/i.test(rawMsg)
    ) {
      console.error('[CHORMO AI] Gemini TTS auth error:', status || rawMsg);
      sendJson(res, 401, {
        code: 'AUTH_ERROR',
        error: 'Speech synthesis authentication failed. Verify GEMINI_API_KEY in environment settings.',
      });
      return;
    }

    console.warn('[CHORMO AI] Gemini TTS warning:', status || rawMsg || 'unknown');
    sendJson(res, 502, {
      code: 'UPSTREAM_ERROR',
      error: 'Cloud speech synthesis unavailable.',
    });
  }
}
