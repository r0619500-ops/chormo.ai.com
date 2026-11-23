import React, { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';

interface ImageGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImageGenerator({ isOpen, onClose }: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string>('');

  const revokeCurrentImage = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokeCurrentImage();
    };
  }, []);

  const generateImage = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');
    revokeCurrentImage();
    setImage('');

    try {
      const url =
        'https://image.pollinations.ai/prompt/' +
        encodeURIComponent(cleanPrompt) +
        '?width=1024&height=1024&nologo=true';

      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error('Image generation failed. Please try again.');
      }

      const blob = await response.blob();

      if (!blob.type.startsWith('image/')) {
        throw new Error('The provider did not return an image.');
      }

      const imageUrl = URL.createObjectURL(blob);
      objectUrlRef.current = imageUrl;
      setImage(imageUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message =
        err instanceof Error && err.message ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void generateImage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void generateImage();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CHORMO AI Image Creator"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02050d]/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-cyan-400/20 bg-[#071124]/95 shadow-[0_0_50px_rgba(6,182,212,0.18)] overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-cyan-400/15 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/15 flex items-center justify-center text-cyan-300">
              <ImagePlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-sky-50">
                Chormo AI Image Creator
              </h2>
              <p className="text-xs text-slate-400">
                Synthesize high-resolution visual artwork from text
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Image Creator"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the image you want..."
              rows={3}
              aria-label="Image prompt"
              className="w-full rounded-xl bg-[#040917]/90 border border-cyan-400/20 focus:border-cyan-400/55 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none resize-none transition-colors"
            />

            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-slate-500">
                1024 × 1024 · Press Ctrl/Cmd + Enter to generate
              </span>

              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-cyan-400 to-sky-500 text-[#030712] text-sm font-semibold shadow-[0_0_20px_rgba(34,211,238,0.35)] hover:shadow-[0_0_28px_rgba(34,211,238,0.55)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating Image...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Image</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {loading && (
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/8 px-4 py-6 flex flex-col items-center justify-center gap-2.5 text-center">
              <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
              <p className="text-xs text-cyan-200">
                Creating your image. Please wait...
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          {image && (
            <div className="space-y-3">
              <div className="rounded-2xl overflow-hidden border border-cyan-400/25 bg-[#040917] shadow-[0_0_32px_rgba(34,211,238,0.12)]">
                <img
                  src={image}
                  alt="AI generated artwork"
                  className="w-full max-h-[420px] object-contain mx-auto block"
                />
              </div>

              <div className="flex justify-end">
                <a
                  href={image}
                  download="chormo-ai-image.png"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 hover:bg-cyan-500/25 text-xs font-medium text-cyan-100 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Download Image</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
