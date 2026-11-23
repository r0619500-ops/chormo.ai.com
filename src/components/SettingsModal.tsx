import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, SlidersHorizontal, Square, Trash2, Volume2, X } from 'lucide-react';
import type { AppSettings, VoiceEngineMode } from '../types/chat';
import {
  ensureVoicesLoaded,
  getSharedAudioContext,
  listAvailableVoices,
  resolveConsistentVoice,
  synthesizeGeminiSpeech,
  unlockAudioContext,
  type VoiceOptionItem,
} from '../utils/voiceSpeech';

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
  const [voices, setVoices] = useState<VoiceOptionItem[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const previewAbortRef = useRef<AbortController | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const stopPreview = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.onended = null;
        previewSourceRef.current.stop();
      } catch {
        // Ignore
      }
      previewSourceRef.current = null;
    }
    if (previewAudioRef.current) {
      try {
        previewAudioRef.current.onended = null;
        previewAudioRef.current.pause();
      } catch {
        // Ignore
      }
      previewAudioRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setPreviewState('idle');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setConfirmClear(false);
      setVoiceError(null);
      stopPreview();
      return;
    }

    let cancelled = false;
    setLoadingVoices(true);
    void ensureVoicesLoaded().then((loaded) => {
      if (cancelled) return;
      setVoices(listAvailableVoices(loaded));
      setLoadingVoices(false);
      if (!settings.voiceURI && loaded.length > 0) {
        const chosen = resolveConsistentVoice(loaded, '', settings.voiceLang);
        if (chosen) {
          onUpdateSettings({
            ...settings,
            voiceURI: chosen.voiceURI,
            voiceLang: chosen.lang || 'en-US',
          });
        }
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, onUpdateSettings, settings, stopPreview]);

  if (!isOpen) return null;

  const toggleSetting = (
    key: keyof Pick<
      AppSettings,
      'gridEnabled' | 'particlesEnabled' | 'scanlineEnabled' | 'autoSpeakResponses'
    >
  ) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleEngineChange = (engine: VoiceEngineMode) => {
    stopPreview();
    setVoiceError(null);
    onUpdateSettings({
      ...settings,
      voiceEngine: engine,
    });
  };

  const handleVoiceChange = (voiceURI: string) => {
    stopPreview();
    setVoiceError(null);
    const match = voices.find((v) => v.voiceURI === voiceURI);
    onUpdateSettings({
      ...settings,
      voiceURI,
      voiceLang: match?.lang || settings.voiceLang || 'en-US',
    });
  };

  const handleTestVoice = async () => {
    if (previewState !== 'idle') {
      stopPreview();
      return;
    }

    unlockAudioContext();
    setVoiceError(null);
    const sampleText = 'CHORMO AI voice lock active. Tone, accent, and pace remain consistent.';

    if (settings.voiceEngine === 'cloud-kore') {
      setPreviewState('loading');
      const controller = new AbortController();
      previewAbortRef.current = controller;
      const result = await synthesizeGeminiSpeech(sampleText, controller.signal);
      if (controller.signal.aborted) {
        setPreviewState('idle');
        return;
      }

      if (!result.buffer) {
        setPreviewState('idle');
        setVoiceError(
          result.error ||
            'Studio Voice is unavailable right now. Switch to Locked System Voice for uninterrupted playback.'
        );
        return;
      }

      setPreviewState('playing');
      const ctx = getSharedAudioContext();
      if (ctx) {
        try {
          if (ctx.state === 'suspended') {
            await ctx.resume();
          }
          if (ctx.state === 'running') {
            const decoded = await ctx.decodeAudioData(result.buffer.slice(0));
            const source = ctx.createBufferSource();
            source.buffer = decoded;
            source.playbackRate.value = settings.speechRate || 1.0;
            source.connect(ctx.destination);
            previewSourceRef.current = source;
            source.onended = () => {
              if (previewSourceRef.current === source) {
                previewSourceRef.current = null;
                setPreviewState('idle');
              }
            };
            source.start(0);
            return;
          }
        } catch {
          // Try HTMLAudioElement below
        }
      }

      try {
        const blob = new Blob([result.buffer], { type: result.mimeType });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        const audio = new Audio(url);
        audio.playbackRate = settings.speechRate || 1.0;
        previewAudioRef.current = audio;
        audio.onended = () => stopPreview();
        audio.onerror = () => {
          stopPreview();
          setVoiceError('Unable to play synthesized Studio Voice audio.');
        };
        await audio.play();
      } catch {
        stopPreview();
        setVoiceError('Browser audio playback was blocked or unavailable.');
      }
      return;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoiceError('System speech synthesis is not supported in this browser.');
      return;
    }

    setPreviewState('loading');
    const loaded = await ensureVoicesLoaded();
    const resolved = resolveConsistentVoice(loaded, settings.voiceURI, settings.voiceLang);
    if (!resolved) {
      setPreviewState('idle');
      setVoiceError('No compatible system voice was found in this browser.');
      return;
    }

    if (!settings.voiceURI) {
      onUpdateSettings({
        ...settings,
        voiceURI: resolved.voiceURI,
        voiceLang: resolved.lang || 'en-US',
      });
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sampleText);
    utterance.voice = resolved;
    utterance.lang = resolved.lang || settings.voiceLang || 'en-US';
    utterance.rate = settings.speechRate || 1.0;
    utterance.pitch = settings.speechPitch || 1.0;

    utterance.onstart = () => setPreviewState('playing');
    utterance.onend = () => setPreviewState('idle');
    utterance.onerror = () => {
      setPreviewState('idle');
      setVoiceError('Unable to play the selected voice in this browser.');
    };

    setPreviewState('playing');
    window.speechSynthesis.speak(utterance);
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

        <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
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

          {/* Voice & Speech Consistency */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-300/90">
                <Volume2 className="w-3.5 h-3.5" />
                <span>Voice & Speech Lock</span>
              </div>
              <button
                type="button"
                onClick={handleTestVoice}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cyan-400/30 bg-cyan-500/12 hover:bg-cyan-500/22 text-xs font-medium text-cyan-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                {previewState === 'loading' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : previewState === 'playing' ? (
                  <Square className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current" />
                )}
                <span>{previewState === 'playing' ? 'Stop' : 'Test Voice'}</span>
              </button>
            </div>

            <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
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

            <div className="space-y-1.5">
              <div className="text-sm font-medium text-slate-100">Voice Engine</div>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#040a17] border border-cyan-400/15">
                <button
                  type="button"
                  onClick={() => handleEngineChange('device-locked')}
                  className={[
                    'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    settings.voiceEngine === 'device-locked'
                      ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent',
                  ].join(' ')}
                >
                  Locked System
                </button>
                <button
                  type="button"
                  onClick={() => handleEngineChange('cloud-kore')}
                  className={[
                    'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    settings.voiceEngine === 'cloud-kore'
                      ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent',
                  ].join(' ')}
                >
                  Studio Voice (Kore)
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                {settings.voiceEngine === 'device-locked'
                  ? 'Uses one pinned voice and accent on every reply with zero silent switching.'
                  : 'Uses neural Studio Voice (Kore) consistently without silent accent fallback.'}
              </p>
            </div>

            {settings.voiceEngine === 'device-locked' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="chormo-voice-select"
                  className="block text-sm font-medium text-slate-100"
                >
                  Locked Voice Profile
                </label>
                <select
                  id="chormo-voice-select"
                  value={settings.voiceURI}
                  disabled={loadingVoices || voices.length === 0}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#040a17] border border-cyan-400/20 text-xs text-slate-100 outline-none focus:border-cyan-400/50 cursor-pointer disabled:opacity-50"
                >
                  {loadingVoices ? (
                    <option value="">Loading available voices...</option>
                  ) : voices.length === 0 ? (
                    <option value="">No system voices detected</option>
                  ) : (
                    voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <div className="text-sm font-medium text-slate-100">Speech Pace</div>
                <div className="text-xs text-slate-400">Saved speaking speed</div>
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

            {settings.voiceEngine === 'device-locked' && (
              <div className="flex items-center justify-between gap-4 py-1">
                <div>
                  <div className="text-sm font-medium text-slate-100">Voice Pitch</div>
                  <div className="text-xs text-slate-400">Consistent tonal pitch</div>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[#040a17] border border-cyan-400/15">
                  {[0.95, 1.0, 1.05].map((pitch) => (
                    <button
                      key={pitch}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, speechPitch: pitch })}
                      className={[
                        'px-2.5 py-1 rounded-md text-xs font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap',
                        settings.speechPitch === pitch
                          ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent',
                      ].join(' ')}
                    >
                      {pitch.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {voiceError && (
              <div className="text-xs text-red-200 bg-red-500/10 border border-red-400/25 rounded-lg px-3 py-2">
                {voiceError}
              </div>
            )}
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
