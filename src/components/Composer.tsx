import React, { useEffect, useRef } from 'react';
import { ArrowUp, AudioLines, ImagePlus, Mic, MicOff, Square } from 'lucide-react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
  onOpenVoiceMode: () => void;
  onOpenImageCreator: () => void;
  isStreaming: boolean;
  isListening: boolean;
  voiceSupported: boolean;
  notice: string | null;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onToggleVoice,
  onOpenVoiceMode,
  onOpenImageCreator,
  isStreaming,
  isListening,
  voiceSupported,
  notice,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      onStop();
    } else if (value.trim()) {
      onSubmit();
    }
  };

  const canSend = value.trim().length > 0;

  return (
    <footer className="relative z-10 px-3 sm:px-6 pb-4 pt-2 shrink-0">
      <div className="max-w-[780px] mx-auto">
        {notice && (
          <div
            role="status"
            className="mb-2.5 px-3.5 py-2 rounded-xl border border-cyan-400/25 bg-[#081329]/90 backdrop-blur-xl text-xs text-cyan-200 text-center shadow-[0_0_20px_rgba(34,211,238,0.12)]"
          >
            {notice}
          </div>
        )}

        <form
          onSubmit={handleFormSubmit}
          className={[
            'flex items-end gap-2 pl-4 sm:pl-5 pr-2.5 py-2.5 rounded-2xl',
            'bg-[#071124]/80 backdrop-blur-2xl border transition-all duration-200',
            isListening
              ? 'border-cyan-400/60 shadow-[0_0_32px_rgba(34,211,238,0.22)]'
              : 'border-cyan-400/20 shadow-[0_8px_32px_rgba(0,0,0,0.45)] focus-within:border-cyan-400/55 focus-within:shadow-[0_0_28px_rgba(34,211,238,0.16)]',
          ].join(' ')}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask CHORMO AI anything..."
            aria-label="Message CHORMO AI"
            className="flex-1 min-h-[26px] max-h-[168px] py-1.5 bg-transparent text-[15px] leading-relaxed text-slate-100 placeholder:text-slate-400 resize-none outline-none"
          />

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleVoice}
              title={
                !voiceSupported
                  ? 'Voice dictation unavailable in this browser'
                  : isListening
                    ? 'Stop voice input'
                    : 'Voice dictation'
              }
              aria-label={isListening ? 'Stop voice input' : 'Start voice dictation'}
              className={[
                'relative w-10 h-10 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer',
                isListening
                  ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/60 shadow-[0_0_18px_rgba(34,211,238,0.35)]'
                  : 'text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 border border-transparent',
              ].join(' ')}
            >
              {isListening && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl border border-cyan-300/60 animate-ping opacity-35"
                />
              )}
              {isListening ? (
                <MicOff className="w-[18px] h-[18px] relative z-10" />
              ) : (
                <Mic className="w-[18px] h-[18px] relative z-10" />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenImageCreator}
              title="Open Image Creator"
              aria-label="Open Image Creator"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 border border-transparent hover:border-cyan-400/20 transition-all cursor-pointer"
            >
              <ImagePlus className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={onOpenVoiceMode}
              title="Open Voice Mode"
              aria-label="Open Voice Mode"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-cyan-300 bg-cyan-500/10 border border-cyan-400/20 hover:bg-cyan-500/20 hover:border-cyan-400/45 transition-all cursor-pointer"
            >
              <AudioLines className="w-[18px] h-[18px]" />
            </button>

            <button
              type="submit"
              disabled={!isStreaming && !canSend}
              title={isStreaming ? 'Stop generating' : 'Send message'}
              aria-label={isStreaming ? 'Stop generating' : 'Send message'}
              className={[
                'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer',
                isStreaming
                  ? 'bg-slate-800 border border-cyan-400/35 text-cyan-200 hover:bg-slate-700'
                  : canSend
                    ? 'bg-gradient-to-br from-cyan-400 to-sky-500 text-[#030712] shadow-[0_0_20px_rgba(34,211,238,0.45)] hover:shadow-[0_0_28px_rgba(34,211,238,0.65)] hover:brightness-110'
                    : 'bg-slate-900/70 border border-white/5 text-slate-600 cursor-not-allowed',
              ].join(' ')}
            >
              {isStreaming ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <ArrowUp className="w-[18px] h-[18px] stroke-[2.35]" />
              )}
            </button>
          </div>
        </form>

        <p className="mt-2 text-center text-[11.5px] text-slate-500">
          CHORMO AI can make mistakes. Verify important information.
        </p>
      </div>
    </footer>
  );
}
