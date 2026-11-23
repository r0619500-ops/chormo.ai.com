import { useEffect, useState } from 'react';
import { SlidersHorizontal, Trash2, Volume2, X } from 'lucide-react';
import type { AppSettings } from '../types/chat';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  conversationCount: number;
  onUpdateSettings: (next: AppSettings) => void;
  onClearHistory: () => void;
  onClose: () => void;
}

export function SettingsModal({
  isOpen,
  settings,
  conversationCount,
  onUpdateSettings,
  onClearHistory,
  onClose,
}: SettingsModalProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setConfirmClear(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleSetting = (key: keyof Pick<AppSettings, 'gridEnabled' | 'particlesEnabled' | 'scanlineEnabled' | 'autoSpeakResponses'>) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CHORMO AI Settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02050d]/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-[#071124]/95 shadow-[0_0_50px_rgba(6,182,212,0.16)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-cyan-400/15 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
            <h2 className="font-display text-base font-semibold text-sky-50">
              System Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Holographic Visuals */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-cyan-300/90">
              Holographic Environment
            </h3>

            <label className="flex items-center justify-between gap-4 py-1.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-100">Spatial Grid</div>
                <div className="text-xs text-slate-400">Display subtle architectural backdrop grid</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.gridEnabled}
                onClick={() => toggleSetting('gridEnabled')}
                className={[
                  'w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer border',
                  settings.gridEnabled
                    ? 'bg-cyan-500/30 border-cyan-400/60'
                    : 'bg-slate-800/80 border-slate-700',
                ].join(' ')}
              >
                <span
                  className={[
                    'block w-4 h-4 rounded-full transition-transform',
                    settings.gridEnabled
                      ? 'translate-x-5.5 bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      : 'translate-x-1 bg-slate-400',
                  ].join(' ')}
                />
              </button>
            </label>

            <label className="flex items-center justify-between gap-4 py-1.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-100">Digital Particles</div>
                <div className="text-xs text-slate-400">Ambient floating light particles</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.particlesEnabled}
                onClick={() => toggleSetting('particlesEnabled')}
                className={[
                  'w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer border',
                  settings.particlesEnabled
                    ? 'bg-cyan-500/30 border-cyan-400/60'
                    : 'bg-slate-800/80 border-slate-700',
                ].join(' ')}
              >
                <span
                  className={[
                    'block w-4 h-4 rounded-full transition-transform',
                    settings.particlesEnabled
                      ? 'translate-x-5.5 bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      : 'translate-x-1 bg-slate-400',
                  ].join(' ')}
                />
              </button>
            </label>

            <label className="flex items-center justify-between gap-4 py-1.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-100">Holographic Scan Sweep</div>
                <div className="text-xs text-slate-400">Soft vertical light sweep across display</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.scanlineEnabled}
                onClick={() => toggleSetting('scanlineEnabled')}
                className={[
                  'w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer border',
                  settings.scanlineEnabled
                    ? 'bg-cyan-500/30 border-cyan-400/60'
                    : 'bg-slate-800/80 border-slate-700',
                ].join(' ')}
              >
                <span
                  className={[
                    'block w-4 h-4 rounded-full transition-transform',
                    settings.scanlineEnabled
                      ? 'translate-x-5.5 bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      : 'translate-x-1 bg-slate-400',
                  ].join(' ')}
                />
              </button>
            </label>
          </div>

          <div className="h-px bg-cyan-400/10" />

          {/* Voice & Audio */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-300/90">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Voice & Speech</span>
            </div>

            <label className="flex items-center justify-between gap-4 py-1.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-slate-100">Auto-Speak Replies</div>
                <div className="text-xs text-slate-400">Read new responses aloud automatically</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoSpeakResponses}
                onClick={() => toggleSetting('autoSpeakResponses')}
                className={[
                  'w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer border',
                  settings.autoSpeakResponses
                    ? 'bg-cyan-500/30 border-cyan-400/60'
                    : 'bg-slate-800/80 border-slate-700',
                ].join(' ')}
              >
                <span
                  className={[
                    'block w-4 h-4 rounded-full transition-transform',
                    settings.autoSpeakResponses
                      ? 'translate-x-5.5 bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      : 'translate-x-1 bg-slate-400',
                  ].join(' ')}
                />
              </button>
            </label>

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-sm font-medium text-slate-100">Speech Pace</div>
                <div className="text-xs text-slate-400">Adjust voice playback speed</div>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#040a17] border border-cyan-400/15">
                {[0.9, 1.0, 1.15].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, speechRate: rate })}
                    className={[
                      'px-2.5 py-1 rounded-md text-xs font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap',
                      settings.speechRate === rate
                        ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent',
                    ].join(' ')}
                  >
                    {rate.toFixed(2).replace(/\.00$/, '.0')}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="h-px bg-cyan-400/10" />

          {/* Conversation Storage */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-cyan-300/90">
              Memory & History
            </h3>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-100">Clear Chat History</div>
                <div className="text-xs text-slate-400 tabular-nums">
                  {conversationCount} saved {conversationCount === 1 ? 'conversation' : 'conversations'}
                </div>
              </div>

              {confirmClear ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearHistory();
                      setConfirmClear(false);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-400/40 text-xs font-medium text-red-200 hover:bg-red-500/30 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Confirm
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={conversationCount === 0}
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-400/25 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-red-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
