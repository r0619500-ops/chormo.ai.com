const REQUEST_TIMEOUT_MS = 38_000;
const MAX_CLIENT_RETRIES = 2;

class ChatStreamRequestError extends Error {
  status: number;
  retryable: boolean;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    options: { status: number; retryable: boolean; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = 'ChatStreamRequestError';
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 408;
}

function friendlyHttpErrorMessage(status: number, serverMessage?: string): string {
  if (serverMessage && serverMessage.trim() && !serverMessage.trim().startsWith('<')) {
    return serverMessage.trim();
  }
  if (status === 429) {
    return 'AI provider quota or rate limit reached. Please wait a moment and try again.';
  }
  if (status === 504 || status === 408) {
    return 'The AI service timed out while responding. Please try again.';
  }
  if (status === 502 || status === 503) {
    return 'The AI service is temporarily busy due to high demand. Please try again in a few seconds.';
  }
  if (status === 401 || status === 403) {
    return 'AI authentication failed. Please check the server API key configuration.';
  }
  return `Request failed (${status}). Please try again.`;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readNonOkError(res: Response): Promise<ChatStreamRequestError> {
  const retryAfterHeader = Number(res.headers.get('retry-after') || '0');
  const retryAfterSeconds =
    Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? Math.min(30, Math.ceil(retryAfterHeader))
      : undefined;

  let serverMessage = '';
  try {
    const raw = await res.text();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { error?: string; message?: string };
        serverMessage = parsed.error || parsed.message || '';
      } catch {
        serverMessage = raw.trim().startsWith('<') ? '' : raw.slice(0, 200);
      }
    }
  } catch {
    serverMessage = '';
  }

  return new ChatStreamRequestError(friendlyHttpErrorMessage(res.status, serverMessage), {
    status: res.status,
    retryable: isRetryableHttpStatus(res.status),
    retryAfterSeconds,
  });
}

const BROWSER_FALLBACK_SYSTEM =
  'You are CHROMO AI, an intelligent, thoughtful AI assistant founded by Meet Shasane. Keep replies concise, clear, and natural unless asked for deep detail.';

let browserFreeCooldownUntil = 0;

async function tryBrowserDirectFreeFallback(options: {
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  onDelta: (accumulatedText: string) => void;
}): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return null;
  }
  if (Date.now() < browserFreeCooldownUntil) {
    return null;
  }

  const normalized = options.messages
    .slice(-24)
    .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      content: m.content.trim().slice(0, 16_000),
    }));

  if (normalized.length === 0) return null;

  const controller = new AbortController();
  let timedOut = false;
  let accumulated = '';
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  const timer = window.setTimeout(() => {
    if (!accumulated) {
      timedOut = true;
      controller.abort();
    }
  }, 15_000);

  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai',
        stream: true,
        messages: [{ role: 'system', content: BROWSER_FALLBACK_SYSTEM }, ...normalized],
      }),
    });

    if (!res.ok || !res.body) {
      if (res.status === 402 || res.status === 429) {
        browserFreeCooldownUntil = Date.now() + 45_000;
      }
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneReading = false;

    while (!doneReading && !options.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        if (jsonStr === '[DONE]') {
          doneReading = true;
          break;
        }
        try {
          const parsed = JSON.parse(jsonStr) as {
            choices?: Array<{
              delta?: { content?: string | null };
              message?: { content?: string | null };
            }>;
          };
          const piece =
            parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
          if (typeof piece === 'string' && piece.length > 0) {
            if (!accumulated) {
              window.clearTimeout(timer);
            }
            accumulated += piece;
            options.onDelta(accumulated);
          }
        } catch {
          // Ignore malformed chunk
        }
      }
    }

    return accumulated.trim() ? accumulated : null;
  } catch {
    if (timedOut) {
      browserFreeCooldownUntil = Date.now() + 15_000;
    }
    return null;
  } finally {
    window.clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

export async function streamChatCompletion(options: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  onDelta: (accumulatedText: string) => void;
  onRetryNotice?: (info: { attempt: number; maxRetries: number; waitSeconds: number }) => void;
}): Promise<string> {
  const { model, messages, signal, onDelta, onRetryNotice } = options;

  let lastError: unknown = null;

  for (let retryIndex = 0; retryIndex <= MAX_CLIENT_RETRIES; retryIndex += 1) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const attemptController = new AbortController();
    let timedOut = false;

    const onExternalAbort = () => attemptController.abort();
    signal.addEventListener('abort', onExternalAbort, { once: true });
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, REQUEST_TIMEOUT_MS);

    let accumulated = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: attemptController.signal,
        body: JSON.stringify({ model, messages }),
      });

      if (!res.ok) {
        throw await readNonOkError(res);
      }

      if (!res.body) {
        throw new ChatStreamRequestError('Streaming response unavailable.', {
          status: 502,
          retryable: true,
        });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processEvents = (rawEvents: string[]) => {
        for (const evt of rawEvents) {
          const lines = evt.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;

            const parsed = JSON.parse(jsonStr) as {
              type: string;
              text?: string;
              message?: string;
              status?: number;
              retryable?: boolean;
              retryAfterSeconds?: number;
            };

            if (parsed.type === 'delta' && parsed.text) {
              accumulated += parsed.text;
              onDelta(accumulated);
            } else if (parsed.type === 'error') {
              const errStatus = typeof parsed.status === 'number' ? parsed.status : 503;
              const isRetryable =
                typeof parsed.retryable === 'boolean'
                  ? parsed.retryable
                  : isRetryableHttpStatus(errStatus);
              throw new ChatStreamRequestError(
                parsed.message || 'Unable to generate a response right now.',
                {
                  status: errStatus,
                  retryable: isRetryable,
                  retryAfterSeconds: parsed.retryAfterSeconds,
                }
              );
            }
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            processEvents(buffer.replace(/\r\n/g, '\n').split('\n\n'));
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        processEvents(events);
      }

      if (!accumulated.trim()) {
        throw new ChatStreamRequestError('Empty response received. Please try again.', {
          status: 502,
          retryable: true,
        });
      }

      return accumulated;
    } catch (err) {
      if (signal.aborted) {
        throw err;
      }

      let mappedError: ChatStreamRequestError;
      if (err instanceof ChatStreamRequestError) {
        mappedError = err;
      } else if (timedOut) {
        mappedError = new ChatStreamRequestError(
          'The request timed out while waiting for the AI service. Please try again.',
          { status: 504, retryable: true }
        );
      } else if (err instanceof TypeError) {
        mappedError = new ChatStreamRequestError(
          'Network error while reaching the AI service. Please check your connection.',
          { status: 503, retryable: true }
        );
      } else if (err instanceof Error) {
        mappedError = new ChatStreamRequestError(err.message, {
          status: 500,
          retryable: false,
        });
      } else {
        mappedError = new ChatStreamRequestError('Unable to generate a response right now.', {
          status: 500,
          retryable: false,
        });
      }

      lastError = mappedError;

      // Never auto-retry once partial text has been streamed or if error is non-retryable
      if (accumulated.trim().length > 0 || !mappedError.retryable || retryIndex >= MAX_CLIENT_RETRIES) {
        if (
          accumulated.trim().length === 0 &&
          !signal.aborted &&
          (mappedError.status === 429 || mappedError.status === 503 || mappedError.status === 504)
        ) {
          const directReply = await tryBrowserDirectFreeFallback({
            messages,
            signal,
            onDelta,
          });
          if (directReply) {
            return directReply;
          }
        }
        throw mappedError;
      }

      const exponentialMs = 1_200 * Math.pow(2, retryIndex) + Math.floor(Math.random() * 350);
      const retryAfterMs = mappedError.retryAfterSeconds
        ? Math.min(6_000, mappedError.retryAfterSeconds * 1_000)
        : 0;
      const waitMs = Math.max(exponentialMs, retryAfterMs);

      onRetryNotice?.({
        attempt: retryIndex + 1,
        maxRetries: MAX_CLIENT_RETRIES,
        waitSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      });

      await sleepWithAbort(waitMs, signal);
    } finally {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('The AI service is temporarily unavailable. Please try again.');
}
