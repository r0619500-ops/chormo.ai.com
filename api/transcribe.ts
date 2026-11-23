import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB base64 audio limit

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
      error: 'Transcription service is not configured. Please set GEMINI_API_KEY on the server.',
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

    const transcribeOnce = () =>
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: 'Transcribe the spoken user speech accurately as plain text. If there is only silence or background noise with no speech, return an empty string.',
            },
          ],
        },
      });

    let response;
    try {
      response = await transcribeOnce();
    } catch (firstErr) {
      const firstStatus = (firstErr as { status?: number; code?: number } | null)?.status;
      if (firstStatus === 401 || firstStatus === 403 || firstStatus === 400) {
        throw firstErr;
      }
      await new Promise((r) => setTimeout(r, 300));
      response = await transcribeOnce();
    }

    const transcript = (response.text || '').trim();
    sendJson(res, 200, { transcript });
  } catch (err) {
    const errObj = err as { status?: number; code?: number; message?: string } | null;
    const status = errObj?.status || errObj?.code;
    console.error('[CHORMO AI] Gemini transcribe error:', status || errObj?.message || 'unknown');

    if (status === 401 || status === 403) {
      sendJson(res, 401, {
        error: 'Authentication failed. Please verify the API key in server environment settings.',
      });
      return;
    }
    if (status === 429) {
      sendJson(res, 429, {
        error: 'Voice transcription rate limit reached. Please wait a moment and try again.',
      });
      return;
    }
    sendJson(res, 502, {
      error: 'Unable to transcribe audio right now. Please try again.',
    });
  }
}
