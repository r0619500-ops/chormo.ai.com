import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const FALLBACK_DEFAULT_MODEL = 'gemini-3.1-flash-lite';

const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
]);

// Tracks only genuine provider daily quota exhaustion per model
const modelDailyExhaustedUntil = new Map<string, number>();

function resolveDefaultModel(): string {
  const envModel = process.env.GEMINI_MODEL?.trim();
  return envModel && ALLOWED_MODELS.has(envModel) ? envModel : FALLBACK_DEFAULT_MODEL;
}

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

function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key || key === 'your_groq_api_key_here') {
    return null;
  }
  return key;
}

function getCerebrasApiKey(): string | null {
  const key = process.env.CEREBRAS_API_KEY?.trim();
  if (!key || key === 'your_cerebras_api_key_here') {
    return null;
  }
  return key;
}

function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key || key === 'your_openrouter_api_key_here') {
    return null;
  }
  return key;
}

function getPollinationsApiKey(): string | null {
  const key = process.env.POLLINATIONS_API_KEY?.trim();
  if (!key || key === 'your_pollinations_api_key_here') {
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

function toOpenAIMessages(
  contents: NormalizedContent[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...contents.map((item) => ({
      role: (item.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: item.parts.map((p) => p.text).join('\n'),
    })),
  ];
}

function extractQuotaDetails(rawMessage: string): {
  retrySeconds?: number;
  isDailyQuota: boolean;
} {
  let retrySeconds: number | undefined;

  const hmsMatch = /retry(?:\s+in|\s+after)?\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)?s/i.exec(rawMessage);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const hours = Number(hmsMatch[1] || 0);
    const mins = Number(hmsMatch[2] || 0);
    const secs = Number(hmsMatch[3] || 0);
    const total = Math.ceil(hours * 3600 + mins * 60 + secs);
    if (Number.isFinite(total) && total > 0) {
      retrySeconds = total;
    }
  }

  if (!retrySeconds) {
    const delayMatch = /"retryDelay"\s*:\s*"(\d+)s"/i.exec(rawMessage);
    if (delayMatch) {
      const parsed = Number(delayMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        retrySeconds = parsed;
      }
    }
  }

  const isDailyQuota =
    /GenerateRequestsPerDay|RequestsPerDay|per day|limit:\s*0/i.test(rawMessage) ||
    (typeof retrySeconds === 'number' && retrySeconds > 120);

  return { retrySeconds, isDailyQuota };
}

function formatResetWindow(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.max(1, Math.round(seconds / 3600));
    return `~${hours}h`;
  }
  if (seconds >= 60) {
    const mins = Math.max(1, Math.round(seconds / 60));
    return `~${mins}m`;
  }
  return `~${Math.max(1, seconds)}s`;
}

function mapFriendlyError(
  err: unknown,
  timedOut = false
): {
  status: number;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  isDailyQuota?: boolean;
} {
  const errorObj = err as { status?: number; code?: number | string; name?: string; message?: string } | null;
  const status = typeof errorObj?.status === 'number' ? errorObj.status : typeof errorObj?.code === 'number' ? errorObj.code : undefined;
  const raw = String(errorObj?.message || '');

  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /api_key_invalid|api key/i.test(raw)) ||
    /api_key_invalid|permission_denied|api key/i.test(raw)
  ) {
    return {
      status: 401,
      message: 'AI authentication failed. Please verify GEMINI_API_KEY in environment variables.',
      retryable: false,
    };
  }
  if (
    status === 429 ||
    status === 402 ||
    /resource_exhausted|quota|rate\s*limit|too many requests|free_limit|free limit reached/i.test(raw)
  ) {
    const { retrySeconds, isDailyQuota } = extractQuotaDetails(raw);
    if (isDailyQuota) {
      const resetHint = retrySeconds ? ` (resets in ${formatResetWindow(retrySeconds)})` : '';
      return {
        status: 429,
        isDailyQuota: true,
        message: `The AI provider's free-tier daily quota has been reached${resetHint}. Please try again later.`,
        retryable: false,
      };
    }

    const waitSeconds = retrySeconds
      ? Math.min(90, Math.max(2, retrySeconds))
      : status === 402
        ? 45
        : 5;
    return {
      status: 429,
      retryAfterSeconds: waitSeconds,
      isDailyQuota: false,
      message: `Free AI capacity is temporarily rate-limited. Please wait ${waitSeconds}s and try again.`,
      retryable: waitSeconds <= 12,
    };
  }
  if (status === 404 || /not_found|no longer available/i.test(raw)) {
    return {
      status: 404,
      message: 'The configured AI model is unavailable for this API key.',
      retryable: false,
    };
  }
  if (
    timedOut ||
    errorObj?.name === 'AbortError' ||
    status === 504 ||
    status === 408 ||
    /deadline|timeout|etimedout|aborted/i.test(raw)
  ) {
    return {
      status: 504,
      message: 'The AI service timed out while responding. Please try again.',
      retryable: true,
    };
  }
  if (
    status === 503 ||
    status === 502 ||
    status === 500 ||
    /unavailable|overloaded|high demand|econnreset|fetch failed|network/i.test(raw)
  ) {
    return {
      status: 503,
      message: 'The AI service is temporarily busy due to high demand. Please try again in a few seconds.',
      retryable: true,
    };
  }
  return {
    status: 500,
    message: 'Unable to generate a response right now. Please try again.',
    retryable: false,
  };
}

function summarizeError(err: unknown): string {
  const errorObj = err as { status?: number; code?: number; name?: string; message?: string } | null;
  const status = errorObj?.status || errorObj?.code || errorObj?.name || 'unknown';
  const raw = String(errorObj?.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  return raw ? `${status}: ${raw}` : String(status);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  const groqApiKey = getGroqApiKey();
  const cerebrasApiKey = getCerebrasApiKey();
  const openRouterApiKey = getOpenRouterApiKey();
  const pollinationsApiKey = getPollinationsApiKey();

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

  const defaultModel = resolveDefaultModel();
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : defaultModel;
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : defaultModel;
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

  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  const runStreamWithModel = async (
    targetModel: string,
    firstChunkTimeoutMs: number
  ): Promise<number> => {
    if (!ai) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const attemptController = new AbortController();
    const onClientAbort = () => attemptController.abort();
    clientAbortController.signal.addEventListener('abort', onClientAbort, { once: true });

    let emittedChars = 0;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      if (emittedChars === 0) {
        timedOut = true;
        attemptController.abort();
      }
    }, firstChunkTimeoutMs);

    try {
      const streamConfig: {
        systemInstruction: string;
        abortSignal: AbortSignal;
        thinkingConfig?: { thinkingLevel: ThinkingLevel };
      } = {
        systemInstruction: SYSTEM_INSTRUCTION,
        abortSignal: attemptController.signal,
      };
      if (targetModel === 'gemini-4-hydrogen') {
        streamConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const stream = await ai.models.generateContentStream({
        model: targetModel,
        contents,
        config: streamConfig,
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
    } catch (err) {
      if (timedOut) {
        const timeoutErr = new Error('Upstream AI stream timed out.');
        timeoutErr.name = 'AbortError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      clientAbortController.signal.removeEventListener('abort', onClientAbort);
    }
  };

  const runOpenAICompatibleChat = async (options: {
    providerLabel: string;
    endpoint: string;
    bearerKey?: string | null;
    modelName: string;
    timeoutMs: number;
    stream: boolean;
  }): Promise<number> => {
    const attemptController = new AbortController();
    const onClientAbort = () => attemptController.abort();
    clientAbortController.signal.addEventListener('abort', onClientAbort, { once: true });

    let emittedChars = 0;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      if (emittedChars === 0) {
        timedOut = true;
        attemptController.abort();
      }
    }, options.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.bearerKey) {
        headers.Authorization = `Bearer ${options.bearerKey}`;
      }

      const upstreamRes = await fetch(options.endpoint, {
        method: 'POST',
        headers,
        signal: attemptController.signal,
        body: JSON.stringify({
          model: options.modelName,
          stream: options.stream,
          messages: toOpenAIMessages(contents),
        }),
      });

      if (!upstreamRes.ok) {
        const rawErr = await upstreamRes.text().catch(() => '');
        const retryAfterHdr = upstreamRes.headers.get('retry-after');
        const parsedHdr = retryAfterHdr ? Number(retryAfterHdr) : NaN;
        const retryHint =
          Number.isFinite(parsedHdr) && (upstreamRes.status !== 402 || parsedHdr >= 5)
            ? ` (Retry after ${parsedHdr}s)`
            : '';
        const httpErr = new Error(
          `${options.providerLabel} returned ${upstreamRes.status}${retryHint}: ${rawErr.slice(0, 400)}`
        ) as Error & { status?: number };
        httpErr.status = upstreamRes.status;
        throw httpErr;
      }

      if (!options.stream || !upstreamRes.body) {
        const json = (await upstreamRes.json().catch(() => null)) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        } | null;
        const text = json?.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.length > 0 && !clientClosed) {
          clearTimeout(timeoutTimer);
          emittedChars += text.length;
          sendEvent({ type: 'delta', text });
        }
        return emittedChars;
      }

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (!clientClosed && !streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) continue;
          if (payloadStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(payloadStr) as {
              choices?: Array<{
                delta?: { content?: string | null };
                message?: { content?: string | null };
              }>;
            };
            const piece =
              parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
            if (typeof piece === 'string' && piece.length > 0) {
              if (emittedChars === 0) {
                clearTimeout(timeoutTimer);
              }
              emittedChars += piece.length;
              sendEvent({ type: 'delta', text: piece });
            }
          } catch {
            // Ignore partial/malformed SSE frames
          }
        }
      }

      return emittedChars;
    } catch (err) {
      if (timedOut) {
        const timeoutErr = new Error(`${options.providerLabel} timed out.`);
        timeoutErr.name = 'AbortError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      clientAbortController.signal.removeEventListener('abort', onClientAbort);
    }
  };

  const startedAt = Date.now();
  const MAX_GEMINI_BUDGET_MS = 12_500;
  const MAX_TOTAL_BUDGET_MS = 27_000;

  try {
    let emittedChars = 0;
    let primaryErr: unknown = null;
    let firstRetryableErr: unknown = null;
    let lastErr: unknown = null;

    const now = Date.now();
    const isModelUnavailable = (m: string) => (modelDailyExhaustedUntil.get(m) ?? 0) > now;

    if (ai) {
      // Primary active free-tier Lite model (gemini-3.1-flash-lite), with fallback to gemini-4-hydrogen
      // if it encounters transient 503/429 limits.
      const fallbackChain = [model, 'gemini-4-hydrogen'].filter(
        (id, idx, arr) => arr.indexOf(id) === idx && !isModelUnavailable(id)
      );

      const attempts = fallbackChain.map((id, idx) => ({
        id,
        timeoutMs: idx === 0 ? 7_500 : 7_500,
        baseBackoffMs: 400,
        isPrimary: id === model,
      }));

      for (let i = 0; i < attempts.length; i++) {
        if (clientClosed) break;
        if (i > 0 && Date.now() - startedAt > MAX_GEMINI_BUDGET_MS) break;

        const { id: targetModel, timeoutMs, baseBackoffMs, isPrimary } = attempts[i];
        if (isModelUnavailable(targetModel)) continue;

        try {
          emittedChars = await runStreamWithModel(targetModel, timeoutMs);
          primaryErr = null;
          firstRetryableErr = null;
          lastErr = null;
          if (emittedChars > 0) break;
        } catch (err) {
          const mapped = mapFriendlyError(err);
          if (mapped.isDailyQuota || mapped.status === 404) {
            modelDailyExhaustedUntil.set(targetModel, Date.now() + 10 * 60 * 1000);
          } else if (mapped.status === 503 || mapped.status === 504) {
            modelDailyExhaustedUntil.set(targetModel, Date.now() + 25 * 1000);
          }

          if (isPrimary) {
            primaryErr = err;
          }
          if (mapped.retryable && !firstRetryableErr) {
            firstRetryableErr = err;
          }
          lastErr = err;

          console.info(`[CHROMO AI] Failover after ${targetModel} (${mapped.status})`);
          if (emittedChars > 0 || clientClosed) {
            throw err;
          }
          if (mapped.status === 401) {
            throw err;
          }

          if (i < attempts.length - 1 && baseBackoffMs > 0) {
            const jitter = Math.floor(Math.random() * 200);
            const waitMs = Math.min(
              baseBackoffMs + jitter,
              Math.max(0, MAX_GEMINI_BUDGET_MS - (Date.now() - startedAt))
            );
            if (waitMs > 100) {
              await sleep(waitMs, clientAbortController.signal);
            }
          }
        }
      }
    }

    // Free-forever OpenAI-compatible fallback chain (all 100% free, zero billing):
    // Optional zero-card developer keys (Groq, Cerebras, OpenRouter, Pollinations) if set
    const keyedFreeProviders: Array<{
      cacheKey: string;
      providerLabel: string;
      endpoint: string;
      bearerKey: string;
      modelName: string;
    }> = [];

    if (groqApiKey) {
      keyedFreeProviders.push({
        cacheKey: 'groq:llama-3.1-8b-instant',
        providerLabel: 'Groq free tier',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        bearerKey: groqApiKey,
        modelName: 'llama-3.1-8b-instant',
      });
    }
    if (cerebrasApiKey) {
      keyedFreeProviders.push({
        cacheKey: 'cerebras:llama3.1-8b',
        providerLabel: 'Cerebras free tier',
        endpoint: 'https://api.cerebras.ai/v1/chat/completions',
        bearerKey: cerebrasApiKey,
        modelName: 'llama3.1-8b',
      });
    }
    if (openRouterApiKey) {
      keyedFreeProviders.push({
        cacheKey: 'openrouter:free',
        providerLabel: 'OpenRouter free tier',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        bearerKey: openRouterApiKey,
        modelName: 'openrouter/free',
      });
    }
    if (pollinationsApiKey) {
      keyedFreeProviders.push({
        cacheKey: 'pollinations:keyed',
        providerLabel: 'Pollinations free tier',
        endpoint: 'https://text.pollinations.ai/openai',
        bearerKey: pollinationsApiKey,
        modelName: 'openai',
      });
    }

    for (const provider of keyedFreeProviders) {
      if (
        emittedChars > 0 ||
        clientClosed ||
        isModelUnavailable(provider.cacheKey) ||
        Date.now() - startedAt >= MAX_TOTAL_BUDGET_MS - 4_000
      ) {
        continue;
      }

      try {
        emittedChars = await runOpenAICompatibleChat({
          providerLabel: provider.providerLabel,
          endpoint: provider.endpoint,
          bearerKey: provider.bearerKey,
          modelName: provider.modelName,
          timeoutMs: 8_500,
          stream: true,
        });
        if (emittedChars > 0) {
          primaryErr = null;
          firstRetryableErr = null;
          lastErr = null;
          break;
        }
      } catch (providerErr) {
        const mapped = mapFriendlyError(providerErr);
        if (mapped.status === 429) {
          const waitSec = mapped.retryAfterSeconds ?? 120;
          modelDailyExhaustedUntil.set(provider.cacheKey, Date.now() + waitSec * 1000);
        }
        console.info(`[CHROMO AI] ${provider.providerLabel} unavailable (${mapped.status})`);
        lastErr = providerErr;
      }
    }

    // Final keyless, always-free Pollinations text endpoint (1 reply / 45s per IP without key)
    if (
      emittedChars === 0 &&
      !clientClosed &&
      !isModelUnavailable('pollinations:anon') &&
      Date.now() - startedAt < MAX_TOTAL_BUDGET_MS - 3_000
    ) {
      const remainingMs = Math.max(6_500, MAX_TOTAL_BUDGET_MS - (Date.now() - startedAt));
      let pollRateLimited = false;
      try {
        emittedChars = await runOpenAICompatibleChat({
          providerLabel: 'Free AI gateway',
          endpoint: 'https://text.pollinations.ai/openai',
          modelName: 'openai',
          timeoutMs: Math.min(12_000, remainingMs),
          stream: true,
        });
        if (emittedChars > 0) {
          primaryErr = null;
          firstRetryableErr = null;
          lastErr = null;
        }
      } catch (pollErr) {
        const mapped = mapFriendlyError(pollErr);
        if (mapped.status === 429) {
          pollRateLimited = true;
          const cooldownSec = mapped.retryAfterSeconds ?? 45;
          modelDailyExhaustedUntil.set('pollinations:anon', Date.now() + cooldownSec * 1000);
        }
        console.info(`[CHROMO AI] Free AI gateway stream unavailable (${mapped.status})`);
        lastErr = pollErr;
      }

      if (
        emittedChars === 0 &&
        !pollRateLimited &&
        !clientClosed &&
        Date.now() - startedAt < MAX_TOTAL_BUDGET_MS - 2_000
      ) {
        try {
          emittedChars = await runOpenAICompatibleChat({
            providerLabel: 'Free AI gateway',
            endpoint: 'https://text.pollinations.ai/openai',
            modelName: 'openai',
            timeoutMs: 9_000,
            stream: false,
          });
          if (emittedChars > 0) {
            primaryErr = null;
            firstRetryableErr = null;
            lastErr = null;
          }
        } catch (pollUnaryErr) {
          const mapped = mapFriendlyError(pollUnaryErr);
          if (mapped.status === 429) {
            const cooldownSec = mapped.retryAfterSeconds ?? 45;
            modelDailyExhaustedUntil.set('pollinations:anon', Date.now() + cooldownSec * 1000);
          }
          console.info(
            `[CHROMO AI] Free AI gateway unary unavailable (${mapped.status})`
          );
          lastErr = pollUnaryErr;
        }
      }
    }

    if (emittedChars === 0) {
      const pollCooldownUntil = modelDailyExhaustedUntil.get('pollinations:anon') ?? 0;
      const pollRemainingSec = Math.ceil((pollCooldownUntil - Date.now()) / 1000);
      if (!lastErr && pollRemainingSec > 0) {
        const cooldownErr = new Error(
          `Free limit reached. Retry after ${pollRemainingSec}s`
        ) as Error & { status?: number };
        cooldownErr.status = 429;
        lastErr = cooldownErr;
      }

      const lastMapped = lastErr ? mapFriendlyError(lastErr) : null;
      const finalErr =
        lastMapped && lastMapped.status === 429
          ? lastErr
          : primaryErr && mapFriendlyError(primaryErr).status === 404
            ? (firstRetryableErr ?? lastErr ?? primaryErr)
            : (primaryErr ?? firstRetryableErr ?? lastErr);
      if (finalErr) {
        throw finalErr;
      }
    }

    if (!clientClosed) {
      if (emittedChars === 0) {
        sendEvent({
          type: 'error',
          status: 502,
          retryable: true,
          message: 'The AI model returned an empty response. Please try again.',
        });
      } else {
        sendEvent({ type: 'done' });
      }
    }
  } catch (err) {
    if (!clientClosed) {
      const errInfo = mapFriendlyError(err);
      const summary = summarizeError(err);
      if (errInfo.status === 503 || errInfo.status === 429 || errInfo.status === 504) {
        console.warn('[CHROMO AI] Upstream AI unavailable:', errInfo.status, summary);
      } else {
        console.error('[CHROMO AI] AI stream error:', errInfo.status, summary);
      }
      sendEvent({
        type: 'error',
        status: errInfo.status,
        retryable: errInfo.retryable,
        retryAfterSeconds: errInfo.retryAfterSeconds,
        message: errInfo.message,
      });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
