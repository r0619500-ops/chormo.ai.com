import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
]);

const SYSTEM_INSTRUCTION = [
  'You are CHROMO AI, an intelligent, thoughtful AI assistant founded by Meet Shasane.',
  'Keep replies concise, clear, and natural by default unless the user explicitly asks for deep detail.',
  'Use clean Markdown formatting when helpful, and use fenced code blocks with language tags for code.',
  'If you are unsure about something or lack information, state that clearly without guessing.',
].join(' ');

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

interface IncomingChatMessage {
  role?: string;
  content?: string;
}

interface ChatRequestBody {
  model?: unknown;
  messages?: unknown;
}

interface NormalizedContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

type AugmentedRequest = IncomingMessage & {
  body?: unknown;
};

type AugmentedResponse = ServerResponse & {
  flushHeaders?: () => void;
};

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

async function readJsonBody(req: AugmentedRequest): Promise<ChatRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as ChatRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as ChatRequestBody;
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
        resolve(JSON.parse(raw) as ChatRequestBody);
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

function normalizeContents(messages: unknown): NormalizedContent[] {
  if (!Array.isArray(messages)) return [];

  const cleaned: NormalizedContent[] = [];
  const recent = messages.slice(-40) as IncomingChatMessage[];

  for (const msg of recent) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (!text) continue;

    const boundedText = text.length > 32000 ? text.slice(0, 32000) : text;
    const role: 'user' | 'model' =
      msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';

    if (cleaned.length === 0 && role !== 'user') {
      continue;
    }

    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n\n${boundedText}`;
    } else {
      cleaned.push({ role, parts: [{ text: boundedText }] });
    }
  }

  return cleaned;
}

function mapFriendlyError(err: unknown): { status: number; message: string; retryable: boolean } {
  const errorObj = err as { status?: number; code?: number; name?: string; message?: string } | null;
  const status = errorObj?.status || errorObj?.code;
  const raw = String(errorObj?.message || '');

  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /api_key_invalid|api key/i.test(raw)) ||
    /api_key_invalid|permission_denied|api key/i.test(raw)
  ) {
    return {
      status: 401,
      message: 'Authentication failed. Please verify the Gemini API key in environment secrets.',
      retryable: false,
    };
  }
  if (status === 429 || /resource_exhausted|quota|rate limit/i.test(raw)) {
    return {
      status: 429,
      message: 'Rate limit or quota reached. Please wait a moment and try again.',
      retryable: true,
    };
  }
  if (status === 404 || /not_found|no longer available/i.test(raw)) {
    return {
      status: 404,
      message: 'The selected model is unavailable. Try switching models in the top bar.',
      retryable: false,
    };
  }
  if (
    errorObj?.name === 'AbortError' ||
    status === 503 ||
    status === 500 ||
    /unavailable|overloaded|deadline|timeout|aborted/i.test(raw)
  ) {
    return {
      status: 503,
      message: 'Gemini service is temporarily busy. Please try again in a few seconds.',
      retryable: true,
    };
  }
  return {
    status: 500,
    message: 'Unable to generate a response right now. Please try again.',
    retryable: false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req: AugmentedRequest, res: AugmentedResponse): Promise<void> {
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
      error: 'Gemini service is not configured yet. Please set GEMINI_API_KEY on the server.',
    });
    return;
  }

  let body: ChatRequestBody | null = null;
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

  if (!body) {
    sendJson(res, 400, { error: 'Invalid JSON request body.' });
    return;
  }

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : DEFAULT_MODEL;
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const contents = normalizeContents(body.messages);

  if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
    sendJson(res, 400, { error: 'Please enter a valid message before sending.' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientClosed = false;
  const clientAbortController = new AbortController();

  // Listen on res.on('close') rather than req.on('close'):
  // req emits 'close' as soon as the POST body finishes reading, whereas
  // res emits 'close' before writableFinished only when the client disconnects.
  res.on('close', () => {
    if (!res.writableFinished) {
      clientClosed = true;
      clientAbortController.abort();
    }
  });

  const sendEvent = (payload: Record<string, unknown>) => {
    if (!clientClosed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  if (!clientClosed && !res.writableEnded) {
    res.write(': connected\n\n');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const runStreamWithModel = async (targetModel: string, firstChunkTimeoutMs: number): Promise<number> => {
    const attemptController = new AbortController();
    const onClientAbort = () => attemptController.abort();
    clientAbortController.signal.addEventListener('abort', onClientAbort, { once: true });

    let emittedChars = 0;
    const timeoutTimer = setTimeout(() => {
      if (emittedChars === 0) {
        attemptController.abort();
      }
    }, firstChunkTimeoutMs);

    try {
      const config: {
        systemInstruction: string;
        abortSignal: AbortSignal;
        thinkingConfig?: { thinkingLevel: ThinkingLevel };
      } = {
        systemInstruction: SYSTEM_INSTRUCTION,
        abortSignal: attemptController.signal,
      };

      if (targetModel === 'gemini-4-hydrogen') {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const stream = await ai.models.generateContentStream({
        model: targetModel,
        contents,
        config,
      });

      for await (const chunk of stream) {
        if (clientClosed) break;
        const text = chunk?.text;
        if (text) {
          if (emittedChars === 0) {
            clearTimeout(timeoutTimer);
          }
          emittedChars += text.length;
          sendEvent({ type: 'delta', text });
        }
      }
      return emittedChars;
    } finally {
      clearTimeout(timeoutTimer);
      clientAbortController.signal.removeEventListener('abort', onClientAbort);
    }
  };

  try {
    let emittedChars = 0;
    let lastErr: unknown = null;
    const modelsToTry =
      model === 'gemini-4-hydrogen'
        ? [
            { id: 'gemini-4-hydrogen', timeoutMs: 3500 },
            { id: 'gemini-3.1-flash-lite', timeoutMs: 12000 },
          ]
        : [
            { id: 'gemini-3.1-flash-lite', timeoutMs: 12000 },
            { id: 'gemini-3.1-flash-lite', timeoutMs: 12000 },
          ];

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      if (clientClosed) break;
      const { id: targetModel, timeoutMs } = modelsToTry[attempt];
      try {
        emittedChars = await runStreamWithModel(targetModel, timeoutMs);
        lastErr = null;
        if (emittedChars > 0) break;
      } catch (err) {
        lastErr = err;
        const mapped = mapFriendlyError(err);
        if (emittedChars > 0 || clientClosed || !mapped.retryable || attempt === modelsToTry.length - 1) {
          throw err;
        }
        await sleep(300);
      }
    }

    if (lastErr) {
      throw lastErr;
    }

    if (!clientClosed) {
      if (emittedChars === 0) {
        sendEvent({
          type: 'error',
          message: 'The model returned an empty response. Please try regenerating.',
        });
      } else {
        sendEvent({ type: 'done' });
      }
    }
  } catch (err) {
    if (!clientClosed) {
      const errInfo = mapFriendlyError(err);
      console.error('[CHROMO AI] Gemini stream error:', errInfo.status);
      sendEvent({ type: 'error', message: errInfo.message });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
