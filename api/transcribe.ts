import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB base64 audio limit
const MIN_AUDIO_BASE64_LEN = 1200; // Skip tiny silent clips before calling Gemini

type AugmentedRequest = IncomingMessage & {
  body?: unknown;
};

interface TranscribeRequestBody {
  audioBase64?: unknown;
  mimeType?: unknown;
}

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
]);

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

async function readJsonBody(req: AugmentedRequest): Promise<TranscribeRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as TranscribeRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as TranscribeRequestBody;
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
        resolve(JSON.parse(raw) as TranscribeRequestBody);
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

function normalizeMimeType(rawMime: unknown): string {
  if (typeof rawMime !== 'string') return 'audio/webm';
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a' || base === 'video/mp4') {
    return 'audio/mp4';
  }
  if (base === 'video/webm') {
    return 'audio/webm';
  }
  if (ALLOWED_AUDIO_MIME_TYPES.has(base)) {
    return base;
  }
  return 'audio/webm';
}

function extractRetrySeconds(rawMessage: string): number {
  const secMatch = /retry(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*s/i.exec(rawMessage);
  if (secMatch) {
    const parsed = Math.ceil(Number(secMatch[1]));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(300, parsed);
    }
  }
  return 45;
}

function isRateLimitError(status: number | undefined, rawMessage: string): boolean {
  return status === 429 || /resource_exhausted|quota|rate\s*limit|too many requests/i.test(rawMessage);
}

let transcribePrimaryCooldownUntil = 0;
let transcribeAllCooldownUntil = 0;

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
      error: 'Voice transcription is not configured. Please set GEMINI_API_KEY in your environment variables.',
    });
    return;
  }

  let body: TranscribeRequestBody | null = null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Audio clip is too large. Please keep voice turns concise.' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request body.' });
    return;
  }

  if (!body || typeof body.audioBase64 !== 'string' || !body.audioBase64.trim()) {
    sendJson(res, 400, { error: 'Audio data is required for transcription.' });
    return;
  }

  const audioBase64 = body.audioBase64.trim();
  if (audioBase64.length < MIN_AUDIO_BASE64_LEN) {
    sendJson(res, 200, { transcript: '' });
    return;
  }

  const now = Date.now();
  if (now < transcribeAllCooldownUntil) {
    const retryAfterSeconds = Math.max(1, Math.ceil((transcribeAllCooldownUntil - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendJson(res, 429, {
      code: 'RATE_LIMITED',
      retryAfterSeconds,
      error: `Voice transcription usage limit reached. Please wait ~${retryAfterSeconds}s or type your message below.`,
    });
    return;
  }

  const mimeType = normalizeMimeType(body.mimeType);

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const transcribeWithModel = (modelId: string) =>
      ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: 'Transcribe the clearly audible human speech in English (or the spoken language) verbatim as plain text. If the audio contains only silence, static, breath, or background noise with no clear spoken words, output only the exact token [SILENCE]. Never guess or invent words.',
            },
          ],
        },
      });

    const candidateModels =
      now < transcribePrimaryCooldownUntil
        ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
        : ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

    let response;
    let lastErr: unknown = null;

    for (const modelId of candidateModels) {
      try {
        response = await transcribeWithModel(modelId);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const errObj = err as { status?: number; code?: number; message?: string } | null;
        const errStatus = errObj?.status || errObj?.code;
        const errMsg = String(errObj?.message || '');

        if (
          errStatus === 401 ||
          errStatus === 403 ||
          /api_key_invalid|permission_denied|api key/i.test(errMsg)
        ) {
          throw err;
        }

        if (isRateLimitError(errStatus, errMsg)) {
          if (modelId === 'gemini-3.5-transcribe') {
            transcribePrimaryCooldownUntil = Date.now() + extractRetrySeconds(errMsg) * 1000;
          }
          continue;
        }

        // For non-429 model errors (e.g., audio format/404), try next fallback model
        continue;
      }
    }

    if (!response) {
      throw lastErr || new Error('Transcription failed.');
    }

    const rawTranscript = (response.text || '').trim();
    const normalizedTranscript =
      /^(?:""|''|\(?silence\)?\.?|\[silence\]\.?|no speech\.?|none\.?)$/i.test(rawTranscript)
        ? ''
        : rawTranscript;

    sendJson(res, 200, { transcript: normalizedTranscript });
  } catch (err) {
    const errObj = err as { status?: number; code?: number; message?: string } | null;
    const status = errObj?.status || errObj?.code;
    const rawMsg = String(errObj?.message || '');

    if (
      status === 401 ||
      status === 403 ||
      /api_key_invalid|permission_denied|api key/i.test(rawMsg)
    ) {
      console.error('[CHORMO AI] Gemini transcribe auth error:', status || rawMsg);
      sendJson(res, 401, {
        code: 'AUTH_ERROR',
        error: 'Authentication failed. Please verify GEMINI_API_KEY in your environment variables.',
      });
      return;
    }

    if (isRateLimitError(status, rawMsg)) {
      const retryAfterSeconds = extractRetrySeconds(rawMsg);
      transcribeAllCooldownUntil = Date.now() + retryAfterSeconds * 1000;
      console.warn(`[CHORMO AI] Gemini transcribe rate limited (${retryAfterSeconds}s cooldown)`);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      sendJson(res, 429, {
        code: 'RATE_LIMITED',
        retryAfterSeconds,
        error: `Voice transcription usage limit reached. Please wait ~${retryAfterSeconds}s or type your message below.`,
      });
      return;
    }

    console.warn('[CHORMO AI] Gemini transcribe warning:', status || rawMsg || 'unknown');
    sendJson(res, 502, {
      code: 'UPSTREAM_ERROR',
      error: 'Unable to transcribe audio right now. Please try again.',
    });
  }
}
