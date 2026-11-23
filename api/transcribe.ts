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

function extractQuotaSeconds(rawMessage: string): { seconds: number; isDaily: boolean } {
  const hmsMatch = /retry(?:\s+in|\s+after)?\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)?s/i.exec(rawMessage);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const total = Math.ceil(
      Number(hmsMatch[1] || 0) * 3600 +
        Number(hmsMatch[2] || 0) * 60 +
        Number(hmsMatch[3] || 0)
    );
    if (Number.isFinite(total) && total > 0) {
      const isDaily = /GenerateRequestsPerDay|RequestsPerDay|per day|limit:\s*0/i.test(rawMessage) || total > 120;
      return { seconds: total, isDaily };
    }
  }
  const delayMatch = /"retryDelay"\s*:\s*"(\d+)s"/i.exec(rawMessage);
  if (delayMatch) {
    const total = Number(delayMatch[1]);
    if (Number.isFinite(total) && total > 0) {
      const isDaily = /GenerateRequestsPerDay|RequestsPerDay|per day|limit:\s*0/i.test(rawMessage) || total > 120;
      return { seconds: total, isDaily };
    }
  }
  const isDaily = /GenerateRequestsPerDay|RequestsPerDay|per day|limit:\s*0/i.test(rawMessage);
  return { seconds: isDaily ? 3600 : 10, isDaily };
}

function isRateLimitError(status: number | undefined, rawMessage: string): boolean {
  return status === 429 || /resource_exhausted|quota|rate\s*limit|too many requests/i.test(rawMessage);
}

const modelCooldownUntil = new Map<string, number>();

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

    const allCandidateModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
    const activeCandidates = allCandidateModels.filter(
      (id) => (modelCooldownUntil.get(id) ?? 0) <= now
    );
    const candidateModels = activeCandidates.length > 0 ? activeCandidates : ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'];

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
          const quota = extractQuotaSeconds(errMsg);
          const skipMs = quota.isDaily ? 10 * 60 * 1000 : Math.min(30, quota.seconds) * 1000;
          modelCooldownUntil.set(modelId, Date.now() + skipMs);
          continue;
        }

        // For non-429 model errors (e.g., audio format/404/503), try next fallback model
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
      const quota = extractQuotaSeconds(rawMsg);
      const retryAfterSeconds = quota.isDaily ? 0 : Math.min(20, Math.max(2, quota.seconds));
      console.warn(`[CHORMO AI] Gemini transcribe provider quota/rate limit (${quota.isDaily ? 'daily' : `${retryAfterSeconds}s`})`);
      if (retryAfterSeconds > 0) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
      sendJson(res, 429, {
        code: 'RATE_LIMITED',
        ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
        error: quota.isDaily
          ? 'Gemini voice transcription daily free-tier quota is exhausted. Use Browser Voice or type your message below.'
          : `Gemini voice rate limit reached. Please wait ~${retryAfterSeconds}s, switch to Browser Voice, or type below.`,
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
