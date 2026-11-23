import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Check, Copy, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { AIState, ChatMessage } from '../types/chat';
import { ChromoLogo } from './ChromoLogo';
import { DigitalHeartCore } from './DigitalHeartCore';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatMessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
  ttsSupported: boolean;
  onToggleSpeak: (message: ChatMessage) => void;
  onRegenerate: () => void;
}

export function ChatMessageItem({
  message,
  isLast,
  isStreaming,
  isSpeaking,
  ttsSupported,
  onToggleSpeak,
  onRegenerate,
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end"
      >
        <div className="max-w-[86%] sm:max-w-[76%] px-4 py-3 rounded-2xl rounded-br-sm bg-gradient-to-br from-cyan-500/20 via-sky-500/15 to-blue-600/15 backdrop-blur-xl text-sky-50 text-[15px] leading-relaxed whitespace-pre-wrap break-words border border-cyan-400/30 shadow-[0_4px_24px_rgba(6,182,212,0.1)]">
          {message.content}
        </div>
      </motion.div>
    );
  }

  const isPending = isStreaming && isLast && !message.content && !message.error;
  const isActivelyStreaming = isStreaming && isLast && Boolean(message.content);
  const showActions = !message.error && !(isStreaming && isLast) && Boolean(message.content);

  const avatarState: AIState = isPending
    ? 'thinking'
    : isActivelyStreaming || isSpeaking
      ? 'responding'
      : 'idle';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="group flex items-start gap-3"
    >
      <div className="mt-0.5 shrink-0">
        {avatarState !== 'idle' ? (
          <DigitalHeartCore state={avatarState} size="compact" />
        ) : (
          <div className="w-9 h-9 flex items-center justify-center">
            <ChromoLogo size="sm" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="rounded-2xl rounded-tl-sm border border-cyan-400/15 bg-[#071124]/65 backdrop-blur-xl px-4 sm:px-5 py-3.5 shadow-[0_6px_28px_rgba(0,0,0,0.3)]">
          {message.error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 text-red-200 text-sm"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{message.error}</span>
              </div>
              <button
                type="button"
                onClick={onRegenerate}
                className="px-3 py-1.5 rounded-lg border border-red-400/35 bg-red-500/15 hover:bg-red-500/25 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : isPending ? (
            <div className="flex items-center gap-2 py-1" aria-label="Generating response">
              <span className="w-2 h-2 rounded-full bg-cyan-400 chormo-dot-1" />
              <span className="w-2 h-2 rounded-full bg-cyan-400 chormo-dot-2" />
              <span className="w-2 h-2 rounded-full bg-cyan-400 chormo-dot-3" />
              <span className="text-xs text-cyan-300/80 ml-1">Processing</span>
            </div>
          ) : (
            <div className="min-w-0">
              <MarkdownRenderer content={message.content} />
              {isStreaming && isLast && (
                <span
                  aria-hidden="true"
                  className="inline-block w-1.5 h-4 ml-1 align-middle rounded-xs bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse"
                />
              )}
            </div>
          )}
        </div>

        {showActions && (
          <div
            className={[
              'flex flex-wrap items-center gap-1 mt-2 transition-opacity duration-150',
              isLast || isSpeaking
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={handleCopy}
              title="Copy response"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-cyan-300" />
                  <span className="text-cyan-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {ttsSupported && (
              <button
                type="button"
                onClick={() => onToggleSpeak(message)}
                title={isSpeaking ? 'Stop reading' : 'Read aloud'}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  isSpeaking
                    ? 'text-cyan-200 bg-cyan-400/15 border border-cyan-400/30'
                    : 'text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10',
                ].join(' ')}
              >
                {isSpeaking ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </>
                )}
              </button>
            )}

            {isLast && (
              <button
                type="button"
                onClick={onRegenerate}
                title="Regenerate response"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
