import { ASPECT_RATIO_OPTIONS } from '../types/imageStudio';
import type { AspectRatioId, AspectRatioOption } from '../types/imageStudio';

const FREE_INTERVAL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 35_000;
let nextProviderAvailableAt = 0;

export function getProviderCooldownSeconds(): number {
  const remaining = Math.ceil((nextProviderAvailableAt - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function createVariationSeed(): number {
  return Math.floor(100_000 + Math.random() * 1_900_000_000);
}

export function getAspectOption(aspectRatio: AspectRatioId): AspectRatioOption {
  return (
    ASPECT_RATIO_OPTIONS.find((item) => item.id === aspectRatio) ||
    ASPECT_RATIO_OPTIONS[0]
  );
}

export function getExtensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  return 'jpg';
}

export class StudioRateLimitError extends Error {
  waitSeconds: number;
  constructor(waitSeconds: number, message: string) {
    super(message);
    this.name = 'StudioRateLimitError';
    this.waitSeconds = waitSeconds;
  }
}

async function parseErrorResponse(res: Response): Promise<{
  isRateLimit: boolean;
  isRetryable: boolean;
  waitSeconds: number;
  message: string;
}> {
  const headerRetry = Number(res.headers.get('retry-after') || '0');
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    rawText = '';
  }

  let parsedMessage = '';
  let parsedCode = '';
  try {
    const json = JSON.parse(rawText) as {
      error?: { code?: string; message?: string } | string;
      message?: string;
    };
    if (typeof json.error === 'object' && json.error) {
      parsedCode = String(json.error.code || '');
      parsedMessage = String(json.error.message || '');
    } else if (typeof json.error === 'string') {
      parsedMessage = json.error;
    } else if (json.message) {
      parsedMessage = String(json.message);
    }
  } catch {
    parsedMessage = rawText.slice(0, 200);
  }

  const retryMatch = /retry\s+after\s+(\d+)\s*s/i.exec(parsedMessage);
  const extractedSec = retryMatch
    ? Number(retryMatch[1])
    : Number.isFinite(headerRetry) && headerRetry > 0
      ? Math.ceil(headerRetry)
      : 45;
  const waitSeconds = Math.max(5, Math.min(120, extractedSec || 45));

  const isRateLimit =
    res.status === 402 ||
    res.status === 429 ||
    parsedCode === 'FREE_LIMIT' ||
    (res.status === 503 && Boolean(retryMatch)) ||
    /rate\s*limit|free\s*limit|too many requests|retry after/i.test(parsedMessage);

  if (isRateLimit) {
    return {
      isRateLimit: true,
      isRetryable: false,
      waitSeconds,
      message: `Free usage limit active — next request ready in ${waitSeconds}s.`,
    };
  }

  const isRetryable = res.status >= 500 || res.status === 408;
  return {
    isRateLimit: false,
    isRetryable,
    waitSeconds: 0,
    message: isRetryable
      ? 'The image service is temporarily busy. Please try again in a moment.'
      : 'Image generation failed. Please check your prompt and try again.',
  };
}

function createCombinedAbort(externalSignal: AbortSignal): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal.aborted) {
    controller.abort();
  } else {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timer);
      externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

export async function waitWithAbort(
  seconds: number,
  signal: AbortSignal,
  onTick: (remaining: number) => void
): Promise<void> {
  let remaining = Math.max(1, Math.ceil(seconds));
  onTick(remaining);

  while (remaining > 0) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, 1000);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    remaining -= 1;
    onTick(Math.max(0, remaining));
  }
}

export async function fetchPollinationsImage(options: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  signal: AbortSignal;
}): Promise<{ url: string; mimeType: string }> {
  const cooldown = getProviderCooldownSeconds();
  if (cooldown > 0) {
    throw new StudioRateLimitError(
      cooldown,
      `Free usage limit active — next request ready in ${cooldown}s.`
    );
  }

  const cleanPrompt = options.prompt.replace(/\s+/g, ' ').trim();
  const params = new URLSearchParams({
    width: String(options.width),
    height: String(options.height),
    seed: String(options.seed),
    nologo: 'true',
  });

  const url =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(cleanPrompt) +
    `?${params.toString()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { signal: reqSignal, didTimeout, cleanup } = createCombinedAbort(options.signal);
    try {
      const response = await fetch(url, {
        signal: reqSignal,
        referrerPolicy: 'no-referrer',
      });

      if (!response.ok) {
        const info = await parseErrorResponse(response);
        if (info.isRateLimit) {
          nextProviderAvailableAt = Date.now() + info.waitSeconds * 1000;
          throw new StudioRateLimitError(info.waitSeconds, info.message);
        }
        if (info.isRetryable && attempt === 0) {
          await new Promise((r) => window.setTimeout(r, 1500));
          continue;
        }
        throw new Error(info.message);
      }

      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) {
        throw new Error('The image provider did not return a valid image.');
      }

      nextProviderAvailableAt = Date.now() + FREE_INTERVAL_MS;
      return {
        url: URL.createObjectURL(blob),
        mimeType: blob.type,
      };
    } catch (err) {
      if (options.signal.aborted) {
        throw err;
      }
      if (didTimeout()) {
        if (attempt === 0) {
          continue;
        }
        throw new Error('Image generation timed out. Please try again.');
      }
      if (err instanceof StudioRateLimitError) {
        throw err;
      }
      if (attempt === 0 && err instanceof TypeError) {
        await new Promise((r) => window.setTimeout(r, 1200));
        continue;
      }
      throw err instanceof Error
        ? err
        : new Error('Unable to reach the image service right now.');
    } finally {
      cleanup();
    }
  }

  throw new Error('Image generation failed. Please try again.');
}
