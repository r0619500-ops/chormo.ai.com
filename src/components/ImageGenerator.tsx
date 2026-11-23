import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Download,
  ImagePlus,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { ChromoLogo } from './ChromoLogo';
import { ASPECT_RATIO_OPTIONS } from '../types/imageStudio';
import type {
  AspectRatioId,
  StudioImageItem,
  StudioQueueSlot,
} from '../types/imageStudio';
import {
  createVariationSeed,
  fetchPollinationsImage,
  getAspectOption,
  getExtensionForMime,
  getProviderCooldownSeconds,
  StudioRateLimitError,
  waitWithAbort,
} from '../utils/imageStudio';

interface ImageGeneratorProps {
  isOpen: boolean;
  images: StudioImageItem[];
  onAddImage: (item: StudioImageItem) => void;
  onReplaceImage: (targetId: string, nextItem: StudioImageItem) => void;
  onRemoveImage: (id: string) => void;
  onClearImages: () => void;
  onClose: () => void;
}

const IMAGE_COUNTS = [1, 2, 3, 4] as const;

function createItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ImageGenerator({
  isOpen,
  images,
  onAddImage,
  onReplaceImage,
  onRemoveImage,
  onClearImages,
  onClose,
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioId>('1:1');
  const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1);
  const [queueSlots, setQueueSlots] = useState<StudioQueueSlot[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(() =>
    getProviderCooldownSeconds()
  );

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsBatchRunning(false);
      setRegeneratingId(null);
      setQueueSlots([]);
      return;
    }

    setCooldownSeconds(getProviderCooldownSeconds());
    const interval = window.setInterval(() => {
      setCooldownSeconds(getProviderCooldownSeconds());
    }, 1000);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const fetchSlotWithRateLimit = useCallback(
    async (
      slot: StudioQueueSlot,
      signal: AbortSignal,
      onUpdateSlot: (patch: Partial<StudioQueueSlot>) => void
    ): Promise<StudioImageItem> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cooldown = getProviderCooldownSeconds();
        if (cooldown > 0) {
          // Wait gracefully for provider pacing (up to 60s)
          await waitWithAbort(cooldown, signal, (remaining) => {
            setCooldownSeconds(remaining);
            onUpdateSlot({
              status: 'waiting',
              waitSeconds: remaining,
              errorMessage: undefined,
            });
          });
        }

        onUpdateSlot({
          status: 'generating',
          waitSeconds: undefined,
          errorMessage: undefined,
        });

        try {
          const result = await fetchPollinationsImage({
            prompt: slot.prompt,
            width: slot.width,
            height: slot.height,
            seed: slot.seed,
            signal,
          });

          setCooldownSeconds(getProviderCooldownSeconds());
          return {
            id: createItemId(),
            url: result.url,
            mimeType: result.mimeType,
            prompt: slot.prompt,
            aspectRatio: slot.aspectRatio,
            width: slot.width,
            height: slot.height,
            seed: slot.seed,
            createdAt: Date.now(),
          };
        } catch (err) {
          if (err instanceof StudioRateLimitError) {
            setCooldownSeconds(err.waitSeconds);
            if (attempt === 0) {
              continue;
            }
          }
          throw err;
        }
      }

      throw new Error('Image generation could not be completed.');
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isBatchRunning || regeneratingId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setErrorNotice(null);
    setIsBatchRunning(true);

    const aspect = getAspectOption(aspectRatio);
    const initialSlots: StudioQueueSlot[] = Array.from({ length: imageCount }, (_, idx) => ({
      slotId: createItemId(),
      index: idx + 1,
      total: imageCount,
      prompt: cleanPrompt,
      aspectRatio,
      width: aspect.width,
      height: aspect.height,
      seed: createVariationSeed(),
      status: 'queued',
    }));

    setQueueSlots(initialSlots);
    let completedCount = 0;

    try {
      for (const slot of initialSlots) {
        if (controller.signal.aborted) break;

        try {
          const item = await fetchSlotWithRateLimit(slot, controller.signal, (patch) => {
            if (!mountedRef.current) return;
            setQueueSlots((prev) =>
              prev.map((s) => (s.slotId === slot.slotId ? { ...s, ...patch } : s))
            );
          });

          if (!mountedRef.current || controller.signal.aborted) {
            URL.revokeObjectURL(item.url);
            break;
          }

          completedCount += 1;
          onAddImage(item);
          setQueueSlots((prev) => prev.filter((s) => s.slotId !== slot.slotId));
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            break;
          }
          const message =
            err instanceof Error && err.message
              ? err.message
              : 'Image generation failed. Please try again.';
          if (mountedRef.current) {
            setQueueSlots((prev) =>
              prev.map((s) =>
                s.slotId === slot.slotId
                  ? { ...s, status: 'error', waitSeconds: undefined, errorMessage: message }
                  : s
              )
            );
          }
        }
      }

      if (mountedRef.current && !controller.signal.aborted && imageCount > 1 && completedCount < imageCount) {
        setErrorNotice(
          `Generated ${completedCount} of ${imageCount} images. You can retry any remaining slot below.`
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (mountedRef.current) {
        setIsBatchRunning(false);
      }
    }
  }, [aspectRatio, fetchSlotWithRateLimit, imageCount, isBatchRunning, onAddImage, prompt, regeneratingId]);

  const handleRetrySlot = useCallback(
    async (slot: StudioQueueSlot) => {
      if (isBatchRunning || regeneratingId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setErrorNotice(null);
      setIsBatchRunning(true);

      const retrySlot: StudioQueueSlot = {
        ...slot,
        seed: createVariationSeed(),
      };

      try {
        const item = await fetchSlotWithRateLimit(retrySlot, controller.signal, (patch) => {
          if (!mountedRef.current) return;
          setQueueSlots((prev) =>
            prev.map((s) => (s.slotId === slot.slotId ? { ...s, ...patch } : s))
          );
        });

        if (!mountedRef.current || controller.signal.aborted) {
          URL.revokeObjectURL(item.url);
          return;
        }

        onAddImage(item);
        setQueueSlots((prev) => prev.filter((s) => s.slotId !== slot.slotId));
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError') && mountedRef.current) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : 'Retry failed. Please try again.';
          setQueueSlots((prev) =>
            prev.map((s) =>
              s.slotId === slot.slotId
                ? { ...s, status: 'error', waitSeconds: undefined, errorMessage: message }
                : s
            )
          );
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (mountedRef.current) {
          setIsBatchRunning(false);
        }
      }
    },
    [fetchSlotWithRateLimit, isBatchRunning, onAddImage, regeneratingId]
  );

  const handleRegenerate = useCallback(
    async (item: StudioImageItem) => {
      if (isBatchRunning || regeneratingId) return;

      const currentCooldown = getProviderCooldownSeconds();
      if (currentCooldown > 0) {
        setCooldownSeconds(currentCooldown);
        setErrorNotice(`Free usage limit active — regenerate ready in ${currentCooldown}s.`);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRegeneratingId(item.id);
      setErrorNotice(null);
      const nextSeed = createVariationSeed();

      try {
        const result = await fetchPollinationsImage({
          prompt: item.prompt,
          width: item.width,
          height: item.height,
          seed: nextSeed,
          signal: controller.signal,
        });

        if (!mountedRef.current || controller.signal.aborted) {
          URL.revokeObjectURL(result.url);
          return;
        }

        onReplaceImage(item.id, {
          ...item,
          id: createItemId(),
          url: result.url,
          mimeType: result.mimeType,
          seed: nextSeed,
          createdAt: Date.now(),
        });
        setCooldownSeconds(getProviderCooldownSeconds());
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (err instanceof StudioRateLimitError) {
          setCooldownSeconds(err.waitSeconds);
        }
        if (mountedRef.current) {
          setErrorNotice(
            err instanceof Error && err.message
              ? err.message
              : 'Could not regenerate this image right now.'
          );
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (mountedRef.current) {
          setRegeneratingId(null);
        }
      }
    },
    [isBatchRunning, onReplaceImage, regeneratingId]
  );

  const handleStopQueue = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsBatchRunning(false);
    setRegeneratingId(null);
    setQueueSlots((prev) => prev.filter((s) => s.status === 'error'));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleGenerate();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chormo AI Image Studio"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#02050d]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-cyan-400/20 bg-[#071124]/95 shadow-[0_0_50px_rgba(6,182,212,0.16)] overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header with existing Chormo AI logo & name */}
        <div className="px-5 py-4 border-b border-cyan-400/15 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ChromoLogo size="sm" />
            <h2 className="font-display text-[15px] sm:text-base font-bold text-sky-50 truncate">
              Chormo AI Image Studio
            </h2>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {cooldownSeconds > 0 && !isBatchRunning && (
              <span className="hidden sm:inline text-xs font-mono text-cyan-300 tabular-nums">
                Ready in {cooldownSeconds}s
              </span>
            )}

            {images.length > 0 && !isBatchRunning && !regeneratingId && (
              <button
                type="button"
                onClick={onClearImages}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-200 hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Chormo AI Image Studio"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Prompt & Compact Controls */}
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the image you want to create..."
              rows={3}
              aria-label="Image prompt"
              className="w-full rounded-xl bg-[#040917]/95 border border-cyan-400/20 focus:border-cyan-400/55 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none resize-none transition-colors"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Aspect Ratios */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-[#040917]/90 border border-cyan-400/15">
                  {ASPECT_RATIO_OPTIONS.map((option) => {
                    const active = option.id === aspectRatio;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isBatchRunning}
                        onClick={() => setAspectRatio(option.id)}
                        className={[
                          'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50',
                          active
                            ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-400/40'
                            : 'text-slate-400 hover:text-slate-200 border border-transparent',
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {/* Image Count (1–4) */}
                <div
                  aria-label="Number of images"
                  className="flex items-center gap-1 p-1 rounded-xl bg-[#040917]/90 border border-cyan-400/15"
                >
                  {IMAGE_COUNTS.map((count) => {
                    const active = count === imageCount;
                    return (
                      <button
                        key={count}
                        type="button"
                        disabled={isBatchRunning}
                        onClick={() => setImageCount(count)}
                        title={`Generate ${count} ${count === 1 ? 'image' : 'images'}`}
                        className={[
                          'w-8 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-colors cursor-pointer disabled:opacity-50',
                          active
                            ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/45'
                            : 'text-slate-400 hover:text-slate-200 border border-transparent',
                        ].join(' ')}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isBatchRunning ? (
                <button
                  type="button"
                  onClick={handleStopQueue}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-400/35 bg-red-500/15 hover:bg-red-500/25 text-xs font-semibold text-red-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Queue</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={!prompt.trim() || Boolean(regeneratingId)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-cyan-400 to-sky-500 text-[#030712] text-sm font-semibold shadow-[0_0_20px_rgba(34,211,238,0.35)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                >
                  <Wand2 className="w-4 h-4" />
                  <span>
                    {imageCount === 1 ? 'Generate Image' : `Generate ${imageCount} Images`}
                  </span>
                </button>
              )}
            </div>

            {imageCount > 1 && (
              <p className="text-[11.5px] text-slate-400">
                Multiple images are generated in separate sequential requests (~45s spacing on free tier).
              </p>
            )}
          </div>

          {/* Error / Status Alert */}
          {errorNotice && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
            >
              <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
              <span className="flex-1">{errorNotice}</span>
              <button
                type="button"
                onClick={() => setErrorNotice(null)}
                aria-label="Dismiss error"
                className="text-red-300 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Empty State */}
          {queueSlots.length === 0 && images.length === 0 && (
            <div className="rounded-2xl border border-cyan-400/12 bg-[#040917]/60 px-6 py-10 flex flex-col items-center justify-center text-center">
              <ImagePlus className="w-7 h-7 text-cyan-400/60 mb-2.5" />
              <p className="text-sm font-medium text-slate-200">
                Chormo AI Image Studio
              </p>
              <p className="mt-1 text-xs text-slate-400 max-w-sm">
                Enter a description, choose Square, Portrait, or Landscape and 1–4 images, then click Generate.
              </p>
            </div>
          )}

          {/* Active Queue Slots + Generated Gallery */}
          {(queueSlots.length > 0 || images.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {queueSlots.map((slot) => (
                <div
                  key={slot.slotId}
                  className="rounded-2xl border border-cyan-400/20 bg-[#040917]/80 p-5 flex flex-col justify-between min-h-[260px]"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium text-cyan-300">
                      Image {slot.index} of {slot.total}
                    </span>
                    <span className="font-mono tabular-nums">
                      {slot.width}×{slot.height}
                    </span>
                  </div>

                  <div className="my-auto py-6 flex flex-col items-center justify-center text-center gap-2.5">
                    {slot.status === 'generating' && (
                      <>
                        <Loader2 className="w-7 h-7 text-cyan-300 animate-spin" />
                        <p className="text-xs font-medium text-white">Creating image...</p>
                      </>
                    )}

                    {slot.status === 'waiting' && (
                      <>
                        <Clock className="w-7 h-7 text-cyan-300" />
                        <p className="text-xs font-medium text-white tabular-nums">
                          Waiting {slot.waitSeconds ?? 0}s for free usage limit...
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Will continue automatically when ready.
                        </p>
                      </>
                    )}

                    {slot.status === 'queued' && (
                      <>
                        <Clock className="w-6 h-6 text-slate-400" />
                        <p className="text-xs text-slate-300">Queued</p>
                      </>
                    )}

                    {slot.status === 'error' && (
                      <>
                        <AlertCircle className="w-7 h-7 text-red-300" />
                        <p className="text-xs font-medium text-red-200">
                          {slot.errorMessage || 'Generation failed.'}
                        </p>
                      </>
                    )}
                  </div>

                  {slot.status === 'error' && (
                    <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-cyan-400/10">
                      <button
                        type="button"
                        onClick={() =>
                          setQueueSlots((prev) =>
                            prev.filter((s) => s.slotId !== slot.slotId)
                          )
                        }
                        className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={isBatchRunning}
                        onClick={() => void handleRetrySlot(slot)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-45 text-xs font-medium text-cyan-100 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {images.map((item) => {
                const isRegen = regeneratingId === item.id;
                const ext = getExtensionForMime(item.mimeType);
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-cyan-400/20 bg-[#040917]/80 overflow-hidden flex flex-col"
                  >
                    <div className="relative aspect-square bg-[#03060f] overflow-hidden">
                      <img
                        src={item.url}
                        alt={item.prompt}
                        className="w-full h-full object-contain"
                      />
                      {isRegen && (
                        <div className="absolute inset-0 bg-[#03060f]/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
                          <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
                          <span className="text-xs text-cyan-100">Regenerating...</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-1">
                        <p className="text-xs text-slate-200 line-clamp-2">{item.prompt}</p>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {item.width}×{item.height}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-cyan-400/10">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBatchRunning || Boolean(regeneratingId)}
                            onClick={() => void handleRegenerate(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-45 text-xs font-medium text-cyan-100 transition-colors cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRegen ? 'animate-spin' : ''}`} />
                            <span>Regenerate</span>
                          </button>

                          <a
                            href={item.url}
                            download={`chormo-ai-${item.seed}.${ext}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cyan-400/20 bg-[#071124] hover:bg-cyan-400/15 text-xs font-medium text-slate-200 hover:text-white transition-colors cursor-pointer"
                          >
                            <Download className="w-3 h-3 text-cyan-300" />
                            <span>Download</span>
                          </a>
                        </div>

                        <button
                          type="button"
                          onClick={() => onRemoveImage(item.id)}
                          aria-label="Remove image"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
