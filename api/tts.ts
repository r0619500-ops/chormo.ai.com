import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TTS_CHARS = 2400;

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
    sendJson(res, 503, { error: 'Speech service is unavailable.' });
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
      const firstStatus = (firstErr as { status?: number; code?: number } | null)?.status;
      if (firstStatus === 401 || firstStatus === 403) {
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
      sendJson(res, 502, { error: 'Speech synthesis returned no audio data.' });
      return;
    }

    sendJson(res, 200, {
      audioBase64: base64Audio,
      mimeType,
    });
  } catch (err) {
    const errObj = err as { status?: number; code?: number; message?: string } | null;
    const status = errObj?.status || errObj?.code;
    console.error('[CHORMO AI] Gemini TTS error:', status, errObj?.message || 'unknown');
    if (status === 429) {
      sendJson(res, 429, { error: 'Speech synthesis rate limit reached.' });
      return;
    }
    if (status === 401 || status === 403) {
      sendJson(res, 401, { error: 'Speech synthesis authentication failed.' });
      return;
    }
    sendJson(res, 502, { error: 'Speech synthesis unavailable.' });
  }
}
