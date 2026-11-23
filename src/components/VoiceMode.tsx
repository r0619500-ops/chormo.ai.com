import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ChromoLogo } from './ChromoLogo';
import { VoiceOrbCanvas } from './VoiceOrbCanvas';
import type { VoiceOrbState } from './VoiceOrbCanvas';
import {
  cleanTextForSpeech,
  ensureVoicesLoaded,
  getSharedAudioContext,
  getSupportedAudioMimeType,
  getTranscribeCooldownSeconds,
  resolveConsistentVoice,
  synthesizeGeminiSpeech,
  transcribeAudioBlob,
  unlockAudioContext,
} from '../utils/voiceSpeech';
import type { AppSettings } from '../types/chat';

interface VoiceModeProps {
  isOpen: boolean;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onClose: () => void;
  onSendTurn: (
    userText: string,
    onStreamDelta: (partialResponse: string) => void,
    signal: AbortSignal
  ) => Promise<{ text: string; error?: string | null }>;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type CaptureEngine = 'speech-api' | 'gemini-audio';

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceMode({
  isOpen,
  settings,
  onUpdateSettings,
  onClose,
  onSendTurn,
}: VoiceModeProps) {
  const [orbState, setOrbState] = useState<VoiceOrbState>('idle');
  const [initializingMic, setInitializingMic] = useState(false);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceErrorEngine, setVoiceErrorEngine] = useState<AppSettings['voiceEngine'] | null>(null);
  const [retryCooldownSec, setRetryCooldownSec] = useState<number>(0);
  const [fallbackInput, setFallbackInput] = useState('');
  const [hasRecordedAudio, setHasRecordedAudio] = useState(false);
  const [captureEngine, setCaptureEngine] = useState<CaptureEngine>(() =>
    getSpeechRecognitionCtor() ? 'speech-api' : 'gemini-audio'
  );

  const audioLevelRef = useRef<number>(0);
  const isOpenRef = useRef(isOpen);
  const micMutedRef = useRef(micMuted);
  const speakerMutedRef = useRef(speakerMuted);
  const orbStateRef = useRef<VoiceOrbState>(orbState);
  const captureEngineRef = useRef<CaptureEngine>(captureEngine);
  const onSendTurnRef = useRef(onSendTurn);
  const settingsRef = useRef<AppSettings>(settings);
  const onUpdateSettingsRef = useRef(onUpdateSettings);

  isOpenRef.current = isOpen;
  micMutedRef.current = micMuted;
  speakerMutedRef.current = speakerMuted;
  orbStateRef.current = orbState;
  captureEngineRef.current = captureEngine;
  onSendTurnRef.current = onSendTurn;
  settingsRef.current = settings;
  onUpdateSettingsRef.current = onUpdateSettings;

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechWatchdogRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analyserRafRef = useRef<number>(0);
  const silenceTimerRef = useRef<number | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const fallbackSpeechRafRef = useRef<number>(0);
  const ttsWatchdogRef = useRef<number | null>(null);
  const ttsPollRef = useRef<number | null>(null);
  const speechTokenRef = useRef<number>(0);
  const lastFailedSpeechRef = useRef<string | null>(null);
  const finalBufferRef = useRef<string>('');
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const speechDetectedRef = useRef<boolean>(false);
  const discardRecordingRef = useRef<boolean>(false);
  const manualSendRef = useRef<boolean>(false);
  const emptyTranscriptCountRef = useRef<number>(0);
  const speechAbortCountRef = useRef<number>(0);
  const voiceNoticeTimerRef = useRef<number | null>(null);

  const speechApiAvailable = Boolean(getSpeechRecognitionCtor());
  const recorderSupported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const showVoiceNotice = useCallback((msg: string, duration = 5000) => {
    setVoiceNotice(msg);
    if (voiceNoticeTimerRef.current) {
      window.clearTimeout(voiceNoticeTimerRef.current);
    }
    voiceNoticeTimerRef.current = window.setTimeout(() => {
      setVoiceNotice(null);
    }, duration);
  }, []);

  const stopMediaRecorderOnly = useCallback((discard: boolean) => {
    discardRecordingRef.current = discard;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        // Ignore stop errors
      }
    }
    mediaRecorderRef.current = null;
    setHasRecordedAudio(false);
  }, []);

  const stopMicAnalyser = useCallback(() => {
    stopMediaRecorderOnly(true);
    if (analyserRafRef.current) {
      window.cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = 0;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    audioLevelRef.current = 0;
    setInitializingMic(false);
  }, [stopMediaRecorderOnly]);

  const stopRecognition = useCallback(() => {
    if (speechWatchdogRef.current) {
      window.clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Ignore abort errors
      }
    }
  }, []);

  const clearTtsTimers = useCallback(() => {
    if (ttsWatchdogRef.current) {
      window.clearTimeout(ttsWatchdogRef.current);
      ttsWatchdogRef.current = null;
    }
    if (ttsPollRef.current) {
      window.clearInterval(ttsPollRef.current);
      ttsPollRef.current = null;
    }
  }, []);

  const stopSpeakingAudio = useCallback(() => {
    speechTokenRef.current += 1;
    clearTtsTimers();

    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
      activeSourceRef.current = null;
    }
    if (activeHtmlAudioRef.current) {
      try {
        activeHtmlAudioRef.current.onended = null;
        activeHtmlAudioRef.current.onerror = null;
        activeHtmlAudioRef.current.pause();
      } catch {
        // Ignore
      }
      activeHtmlAudioRef.current = null;
    }
    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
    if (fallbackSpeechRafRef.current) {
      window.cancelAnimationFrame(fallbackSpeechRafRef.current);
      fallbackSpeechRafRef.current = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    audioLevelRef.current = 0;
  }, [clearTtsTimers]);

  const stopAllActiveTurn = useCallback(() => {
    if (transcribeAbortRef.current) {
      transcribeAbortRef.current.abort();
      transcribeAbortRef.current = null;
    }
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setProcessingLabel(null);
    stopSpeakingAudio();
  }, [stopSpeakingAudio]);

  const startListeningRef = useRef<() => void>(() => {});

  const speakResponse = useCallback(
    async (text: string) => {
      const spoken = cleanTextForSpeech(text);
      if (!spoken || speakerMutedRef.current || !isOpenRef.current) {
        setProcessingLabel(null);
        if (isOpenRef.current && !micMutedRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
        return;
      }

      const token = ++speechTokenRef.current;
      const activeSettings = settingsRef.current;
      const speechRate = activeSettings.speechRate || 1.0;
      const speechPitch = activeSettings.speechPitch || 1.0;

      lastFailedSpeechRef.current = null;
      setVoiceErrorEngine(null);
      setErrorBanner(null);
      setOrbState('speaking');
      stopMicAnalyser();
      stopRecognition();

      let finished = false;
      const finishSpeaking = () => {
        if (finished || speechTokenRef.current !== token) return;
        finished = true;
        clearTtsTimers();
        if (fallbackSpeechRafRef.current) {
          window.cancelAnimationFrame(fallbackSpeechRafRef.current);
          fallbackSpeechRafRef.current = 0;
        }
        if (analyserRafRef.current) {
          window.cancelAnimationFrame(analyserRafRef.current);
          analyserRafRef.current = 0;
        }
        if (activeAudioUrlRef.current) {
          URL.revokeObjectURL(activeAudioUrlRef.current);
          activeAudioUrlRef.current = null;
        }
        activeSourceRef.current = null;
        activeHtmlAudioRef.current = null;
        audioLevelRef.current = 0;
        setProcessingLabel(null);

        if (isOpenRef.current && !micMutedRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
      };

      const failVoiceOutput = (
        engine: AppSettings['voiceEngine'],
        message: string
      ) => {
        if (finished || speechTokenRef.current !== token) return;
        finished = true;
        clearTtsTimers();
        if (fallbackSpeechRafRef.current) {
          window.cancelAnimationFrame(fallbackSpeechRafRef.current);
          fallbackSpeechRafRef.current = 0;
        }
        if (analyserRafRef.current) {
          window.cancelAnimationFrame(analyserRafRef.current);
          analyserRafRef.current = 0;
        }
        if (activeAudioUrlRef.current) {
          URL.revokeObjectURL(activeAudioUrlRef.current);
          activeAudioUrlRef.current = null;
        }
        activeSourceRef.current = null;
        activeHtmlAudioRef.current = null;
        audioLevelRef.current = 0;
        setProcessingLabel(null);
        lastFailedSpeechRef.current = spoken;
        setVoiceErrorEngine(engine);
        setErrorBanner(message);
        setOrbState('idle');
      };

      // Mode 1: Studio Voice (pinned Kore) — never silently falls back to a different-accent browser voice
      if (activeSettings.voiceEngine === 'cloud-kore') {
        setProcessingLabel('Synthesizing Studio voice...');
        const ttsController = new AbortController();
        ttsAbortRef.current = ttsController;

        const synthResult = await synthesizeGeminiSpeech(spoken, ttsController.signal);
        if (speechTokenRef.current !== token || !isOpenRef.current) return;

        if (!synthResult.buffer) {
          failVoiceOutput(
            'cloud-kore',
            synthResult.error ||
              'Studio Voice (Kore) is unavailable right now. Retry or switch to Locked System Voice.'
          );
          return;
        }

        setProcessingLabel(null);

        // Play the exact Kore audio buffer via Web Audio API first
        const ctx = getSharedAudioContext();
        if (ctx) {
          try {
            if (ctx.state === 'suspended') {
              await Promise.race([
                ctx.resume().catch(() => {}),
                new Promise((r) => window.setTimeout(r, 450)),
              ]);
            }

            if (ctx.state === 'running') {
              const decoded = await ctx.decodeAudioData(synthResult.buffer.slice(0));
              if (speechTokenRef.current !== token || !isOpenRef.current) return;

              const source = ctx.createBufferSource();
              source.buffer = decoded;
              source.playbackRate.value = speechRate;

              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              analyser.smoothingTimeConstant = 0.72;

              source.connect(analyser);
              analyser.connect(ctx.destination);
              activeSourceRef.current = source;

              const freqData = new Uint8Array(analyser.frequencyBinCount);
              const sampleSpeech = () => {
                if (speechTokenRef.current !== token || !activeSourceRef.current) {
                  audioLevelRef.current = 0;
                  return;
                }
                analyser.getByteTimeDomainData(freqData);
                let sumSq = 0;
                for (let i = 0; i < freqData.length; i++) {
                  const v = (freqData[i] - 128) / 128;
                  sumSq += v * v;
                }
                const rms = Math.sqrt(sumSq / freqData.length);
                audioLevelRef.current = Math.min(1, rms * 4.2);
                analyserRafRef.current = window.requestAnimationFrame(sampleSpeech);
              };

              const durationMs = Math.max(
                1500,
                Math.ceil((decoded.duration * 1000) / Math.max(0.5, speechRate)) + 1200
              );
              ttsWatchdogRef.current = window.setTimeout(finishSpeaking, durationMs);

              source.onended = () => {
                finishSpeaking();
              };

              source.start(0);
              analyserRafRef.current = window.requestAnimationFrame(sampleSpeech);
              return;
            }
          } catch {
            // Fall through to HTMLAudioElement playback using the same Kore buffer
          }
        }

        // Play the same Kore audio buffer via HTMLAudioElement if Web Audio is unavailable
        try {
          const audioBlob = new Blob([synthResult.buffer], { type: synthResult.mimeType });
          const url = URL.createObjectURL(audioBlob);
          activeAudioUrlRef.current = url;
          const audio = new Audio(url);
          audio.playbackRate = speechRate;
          activeHtmlAudioRef.current = audio;

          let t = 0;
          const animateHtmlAudio = () => {
            if (speechTokenRef.current !== token || !activeHtmlAudioRef.current) {
              audioLevelRef.current = 0;
              return;
            }
            t += 0.14;
            audioLevelRef.current = 0.25 + Math.abs(Math.sin(t) * Math.cos(t * 0.63)) * 0.52;
            fallbackSpeechRafRef.current = window.requestAnimationFrame(animateHtmlAudio);
          };

          audio.onended = finishSpeaking;
          audio.onerror = () => {
            failVoiceOutput('cloud-kore', 'Unable to play Studio Voice audio. Tap Retry Voice.');
          };

          const safetyMs = Math.max(
            6000,
            Math.ceil((spoken.length * 85) / Math.max(0.5, speechRate)) + 2500
          );
          ttsWatchdogRef.current = window.setTimeout(finishSpeaking, safetyMs);

          await audio.play();
          fallbackSpeechRafRef.current = window.requestAnimationFrame(animateHtmlAudio);
          return;
        } catch {
          failVoiceOutput(
            'cloud-kore',
            'Audio playback was blocked or unavailable. Tap Retry Voice to hear the reply.'
          );
          return;
        }
      }

      // Mode 2: Locked System Voice — awaits voiceschanged so message #1 matches every later message
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        failVoiceOutput(
          'device-locked',
          'Speech synthesis is not supported in this browser.'
        );
        return;
      }

      setProcessingLabel('Loading locked voice...');
      const loadedVoices = await ensureVoicesLoaded();
      if (speechTokenRef.current !== token || !isOpenRef.current) return;

      if (loadedVoices.length === 0) {
        failVoiceOutput(
          'device-locked',
          'No system voices are available in this browser right now.'
        );
        return;
      }

      const lockedVoice = resolveConsistentVoice(
        loadedVoices,
        activeSettings.voiceURI,
        activeSettings.voiceLang
      );

      if (!activeSettings.voiceURI && lockedVoice) {
        onUpdateSettingsRef.current({
          ...settingsRef.current,
          voiceURI: lockedVoice.voiceURI,
          voiceLang: lockedVoice.lang || 'en-US',
        });
      }

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(spoken);
        if (lockedVoice) {
          utterance.voice = lockedVoice;
          utterance.lang = lockedVoice.lang || activeSettings.voiceLang || 'en-US';
        } else {
          utterance.lang = activeSettings.voiceLang || 'en-US';
        }
        utterance.rate = speechRate;
        utterance.pitch = speechPitch;

        let t = 0;
        const animateLockedSpeech = () => {
          if (speechTokenRef.current !== token) {
            audioLevelRef.current = 0;
            return;
          }
          t += 0.14;
          audioLevelRef.current = 0.25 + Math.abs(Math.sin(t) * Math.cos(t * 0.63)) * 0.55;
          fallbackSpeechRafRef.current = window.requestAnimationFrame(animateLockedSpeech);
        };

        utterance.onstart = () => {
          if (speechTokenRef.current === token) {
            setProcessingLabel(null);
          }
        };
        utterance.onend = finishSpeaking;
        utterance.onerror = (ev) => {
          if (finished || speechTokenRef.current !== token) return;
          const reason = (ev as { error?: string })?.error;
          if (reason === 'canceled' || reason === 'interrupted') {
            finishSpeaking();
            return;
          }
          failVoiceOutput(
            'device-locked',
            'Unable to play the locked system voice. Tap Retry Voice to try again.'
          );
        };

        const maxSpeakMs = Math.max(
          5000,
          Math.ceil((spoken.length * 90) / Math.max(0.5, speechRate)) + 3000
        );
        ttsWatchdogRef.current = window.setTimeout(finishSpeaking, maxSpeakMs);

        const startedAt = Date.now();
        ttsPollRef.current = window.setInterval(() => {
          if (speechTokenRef.current !== token) return;
          const elapsed = Date.now() - startedAt;
          if (elapsed > 1400 && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            finishSpeaking();
          }
        }, 400);

        fallbackSpeechRafRef.current = window.requestAnimationFrame(animateLockedSpeech);
        window.speechSynthesis.speak(utterance);
        return;
      } catch {
        failVoiceOutput(
          'device-locked',
          'Speech output failed to start. Tap Retry Voice to try again.'
        );
      }
    },
    [clearTtsTimers, stopMicAnalyser, stopRecognition]
  );

  const submitSpokenTurn = useCallback(
    async (prompt: string) => {
      const clean = prompt.trim();
      if (!clean || !isOpenRef.current) return;

      stopRecognition();
      stopMicAnalyser();
      setErrorBanner(null);
      setUserTranscript(clean);
      setAssistantTranscript('');
      setOrbState('thinking');
      setProcessingLabel('Thinking...');

      const controller = new AbortController();
      chatAbortRef.current = controller;

      // Safety 30s timeout for chat turn
      const turnTimeout = window.setTimeout(() => {
        controller.abort();
      }, 30000);

      try {
        const result = await onSendTurnRef.current(
          clean,
          (partial) => {
            if (isOpenRef.current) {
              setProcessingLabel(null);
              setAssistantTranscript(partial);
            }
          },
          controller.signal
        );

        window.clearTimeout(turnTimeout);
        if (!isOpenRef.current) return;

        if (controller.signal.aborted) {
          setProcessingLabel(null);
          setErrorBanner('Response timed out. Please try again.');
          setOrbState('idle');
          return;
        }

        if (result.error) {
          setProcessingLabel(null);
          setErrorBanner(result.error);
          if (!micMutedRef.current) {
            startListeningRef.current();
          } else {
            setOrbState('idle');
          }
          return;
        }

        if (result.text) {
          setProcessingLabel(null);
          setAssistantTranscript(result.text);
          await speakResponse(result.text);
        } else if (!micMutedRef.current) {
          setProcessingLabel(null);
          startListeningRef.current();
        } else {
          setProcessingLabel(null);
          setOrbState('idle');
        }
      } catch (err) {
        window.clearTimeout(turnTimeout);
        setProcessingLabel(null);
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') {
          if (isOpenRef.current && orbStateRef.current === 'thinking') {
            setErrorBanner('Request timed out. Tap Retry to continue.');
            setOrbState('idle');
          }
          return;
        }
        setErrorBanner(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'You appear to be offline. Reconnect and try again.'
            : e?.message || 'Unable to reach CHORMO AI right now.'
        );
        if (!micMutedRef.current && isOpenRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
      } finally {
        window.clearTimeout(turnTimeout);
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
        }
      }
    },
    [speakResponse, stopMicAnalyser, stopRecognition]
  );

  const startGeminiAudioRecorder = useCallback(
    (stream: MediaStream, analyser: AnalyserNode | null) => {
      if (typeof MediaRecorder === 'undefined') {
        setInitializingMic(false);
        setErrorBanner(
          'Audio recording is not supported in this browser. Use the message box below to talk.'
        );
        setOrbState('idle');
        return;
      }

      stopMediaRecorderOnly(true);
      recordedChunksRef.current = [];
      speechDetectedRef.current = false;
      discardRecordingRef.current = false;

      const mimeType = getSupportedAudioMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
      } catch {
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        } catch {
          try {
            recorder = new MediaRecorder(stream);
          } catch {
            setInitializingMic(false);
            setErrorBanner('Unable to start microphone recorder in this browser.');
            setOrbState('idle');
            return;
          }
        }
      }

      const startedAt = performance.now();
      let lastSpeechAt = startedAt;
      let speechFrames = 0;
      let stoppedByVad = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          setHasRecordedAudio(true);
        }
      };

      recorder.onstop = async () => {
        if (mediaRecorderRef.current === recorder) {
          mediaRecorderRef.current = null;
        }
        setHasRecordedAudio(false);

        const shouldDiscard = discardRecordingRef.current;
        const wasManualSend = manualSendRef.current;
        manualSendRef.current = false;
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];

        if (shouldDiscard || !isOpenRef.current || micMutedRef.current) {
          return;
        }

        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });

        const minBytes = wasManualSend ? 900 : 2400;
        if (audioBlob.size < minBytes) {
          if (
            isOpenRef.current &&
            !micMutedRef.current &&
            orbStateRef.current === 'listening' &&
            getTranscribeCooldownSeconds() === 0
          ) {
            startListeningRef.current();
          }
          return;
        }

        stopMicAnalyser();
        setOrbState('thinking');
        setProcessingLabel('Transcribing speech...');
        setUserTranscript('Transcribing...');
        setErrorBanner(null);

        const controller = new AbortController();
        transcribeAbortRef.current = controller;

        const { transcript, error, rateLimited, retryAfterSeconds } = await transcribeAudioBlob(
          audioBlob,
          controller.signal
        );
        if (transcribeAbortRef.current === controller) {
          transcribeAbortRef.current = null;
        }

        if (!isOpenRef.current || controller.signal.aborted) {
          setProcessingLabel(null);
          return;
        }

        if (rateLimited) {
          const waitSec = retryAfterSeconds ?? getTranscribeCooldownSeconds();
          setProcessingLabel(null);
          setUserTranscript('');
          setMicMuted(true);
          micMutedRef.current = true;
          setRetryCooldownSec(waitSec);
          setErrorBanner(
            error ||
              (waitSec > 0
                ? `Voice transcription rate limit reached. Please wait ${waitSec}s, switch to Browser Voice, or type below.`
                : 'Voice transcription quota reached. Switch to Browser Voice or type below.')
          );
          setOrbState('idle');
          return;
        }

        if (error) {
          setProcessingLabel(null);
          setUserTranscript('');
          setErrorBanner(error);
          setOrbState('idle');
          return;
        }

        if (!transcript) {
          emptyTranscriptCountRef.current += 1;
          setProcessingLabel(null);
          setUserTranscript('');

          if (emptyTranscriptCountRef.current >= 2) {
            setMicMuted(true);
            micMutedRef.current = true;
            setOrbState('idle');
            showVoiceNotice(
              "Didn't catch any speech — tap the microphone when you're ready to speak.",
              6000
            );
            return;
          }

          if (!micMutedRef.current) {
            startListeningRef.current();
          } else {
            setOrbState('idle');
          }
          return;
        }

        emptyTranscriptCountRef.current = 0;
        await submitSpokenTurn(transcript);
      };

      mediaRecorderRef.current = recorder;
      try {
        recorder.start(250);
      } catch {
        setInitializingMic(false);
        setErrorBanner('Microphone recording could not be started.');
        setOrbState('idle');
        return;
      }

      setInitializingMic(false);
      setOrbState('listening');

      // Monitor RMS energy for sustained Voice Activity Detection (avoids burning API quota on noise)
      if (!analyser) {
        return;
      }

      const data = new Uint8Array(analyser.frequencyBinCount);
      const monitorVad = () => {
        if (
          !isOpenRef.current ||
          micMutedRef.current ||
          orbStateRef.current !== 'listening' ||
          captureEngineRef.current !== 'gemini-audio' ||
          mediaRecorderRef.current !== recorder
        ) {
          return;
        }

        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128;
          sumSq += normalized * normalized;
        }
        const rms = Math.sqrt(sumSq / data.length);
        audioLevelRef.current = Math.min(1, rms * 4.5);

        const now = performance.now();
        if (rms > 0.032) {
          speechFrames += 1;
          if (speechFrames >= 3) {
            speechDetectedRef.current = true;
            lastSpeechAt = now;
          }
        } else {
          speechFrames = Math.max(0, speechFrames - 1);
        }

        const silenceMs = now - lastSpeechAt;
        const totalMs = now - startedAt;

        if (
          !stoppedByVad &&
          ((speechDetectedRef.current && totalMs >= 650 && silenceMs >= 1150) || totalMs >= 20000)
        ) {
          stoppedByVad = true;
          if (!speechDetectedRef.current) {
            // Restart fresh window if 20s of silence elapsed without speech
            stopMediaRecorderOnly(true);
            startGeminiAudioRecorder(stream, analyser);
            return;
          }
          manualSendRef.current = false;
          stopMediaRecorderOnly(false);
          return;
        }

        analyserRafRef.current = window.requestAnimationFrame(monitorVad);
      };

      analyserRafRef.current = window.requestAnimationFrame(monitorVad);
    },
    [showVoiceNotice, stopMediaRecorderOnly, stopMicAnalyser, submitSpokenTurn]
  );

  const startMicPipeline = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setInitializingMic(false);
      setErrorBanner(
        'Microphone capture requires a secure context (HTTPS) or is unavailable in this browser. Type below to chat.'
      );
      setOrbState('idle');
      return;
    }

    const setupAnalyser = (stream: MediaStream): AnalyserNode | null => {
      const ctx = unlockAudioContext();
      if (!ctx) return null;
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        return analyser;
      } catch {
        return null;
      }
    };

    if (
      mediaStreamRef.current &&
      mediaStreamRef.current.getTracks().some((t) => t.readyState === 'live')
    ) {
      const analyser = setupAnalyser(mediaStreamRef.current);
      startGeminiAudioRecorder(mediaStreamRef.current, analyser);
      return;
    }

    // Release any dead stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setInitializingMic(true);

    let permissionTimer: number | null = null;
    try {
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        permissionTimer = window.setTimeout(() => {
          reject(Object.assign(new Error('Microphone permission timed out'), { name: 'TimeoutError' }));
        }, 12000);
      });

      const stream = await Promise.race([streamPromise, timeoutPromise]);
      if (permissionTimer) window.clearTimeout(permissionTimer);

      if (!isOpenRef.current || micMutedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setInitializingMic(false);
        return;
      }

      mediaStreamRef.current = stream;
      const analyser = setupAnalyser(stream);
      startGeminiAudioRecorder(stream, analyser);
    } catch (err) {
      if (permissionTimer) window.clearTimeout(permissionTimer);
      setInitializingMic(false);
      const e = err as { name?: string };
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setErrorBanner(
          'Microphone permission was denied. Allow microphone access in your browser and tap Retry.'
        );
        setMicMuted(true);
        micMutedRef.current = true;
        setOrbState('idle');
      } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
        setErrorBanner('No microphone was found on this device. Type below to chat.');
        setMicMuted(true);
        micMutedRef.current = true;
        setOrbState('idle');
      } else if (e?.name === 'TimeoutError') {
        setErrorBanner(
          'Microphone initialization timed out. Allow microphone permission or type below to talk.'
        );
        setOrbState('idle');
      } else {
        setErrorBanner('Could not access microphone. Check browser permissions or type below.');
        setOrbState('idle');
      }
    }
  }, [startGeminiAudioRecorder]);

  const startListening = useCallback(() => {
    if (!isOpenRef.current || micMutedRef.current) {
      setInitializingMic(false);
      setOrbState('idle');
      return;
    }

    setErrorBanner(null);
    setProcessingLabel(null);
    finalBufferRef.current = '';

    const SpeechRec = getSpeechRecognitionCtor();
    const shouldUseSpeechApi = captureEngineRef.current === 'speech-api' && Boolean(SpeechRec);

    if (!shouldUseSpeechApi) {
      const cooldown = getTranscribeCooldownSeconds();
      if (cooldown > 0) {
        setInitializingMic(false);
        setMicMuted(true);
        micMutedRef.current = true;
        setRetryCooldownSec(cooldown);
        setErrorBanner(
          `Voice transcription rate limit reached. Please wait ${cooldown}s, switch to Browser Voice, or type below.`
        );
        setOrbState('idle');
        return;
      }

      captureEngineRef.current = 'gemini-audio';
      setCaptureEngine('gemini-audio');
      void startMicPipeline();
      return;
    }

    // Do NOT open getUserMedia simultaneously with SpeechRecognition to avoid dual-mic hardware lockups.
    stopRecognition();
    setInitializingMic(true);

    if (!SpeechRec) return;

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    let started = false;
    // Watchdog: if SpeechRecognition fails to start within 1.8s (common in iframes / privacy browsers), switch to Gemini Audio
    speechWatchdogRef.current = window.setTimeout(() => {
      if (!started && isOpenRef.current && !micMutedRef.current && recognitionRef.current === recognition) {
        captureEngineRef.current = 'gemini-audio';
        setCaptureEngine('gemini-audio');
        stopRecognition();
        const cooldown = getTranscribeCooldownSeconds();
        if (cooldown > 0) {
          setInitializingMic(false);
          setMicMuted(true);
          micMutedRef.current = true;
          setRetryCooldownSec(cooldown);
          setErrorBanner(
            `Browser speech was unavailable and cloud transcription limit is cooling down (${cooldown}s). Type below or try again shortly.`
          );
          setOrbState('idle');
        } else {
          void startMicPipeline();
        }
      }
    }, 1800);

    recognition.onstart = () => {
      started = true;
      speechAbortCountRef.current = 0;
      emptyTranscriptCountRef.current = 0;
      if (speechWatchdogRef.current) {
        window.clearTimeout(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }
      setInitializingMic(false);
      if (isOpenRef.current && !micMutedRef.current) {
        setOrbState('listening');
      }
    };

    recognition.onresult = (event) => {
      if (!isOpenRef.current || orbStateRef.current !== 'listening') return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const part = res[0].transcript;
        if (res.isFinal) {
          finalBufferRef.current = `${finalBufferRef.current} ${part}`.trim();
        } else {
          interim += part;
        }
      }

      const display = [finalBufferRef.current, interim.trim()].filter(Boolean).join(' ');
      if (display) {
        setUserTranscript(display);
      }

      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }

      if (finalBufferRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          const textToSend = finalBufferRef.current.trim();
          finalBufferRef.current = '';
          if (textToSend && isOpenRef.current && orbStateRef.current === 'listening') {
            void submitSpokenTurn(textToSend);
          }
        }, 700);
      }
    };

    recognition.onerror = (event) => {
      if (!isOpenRef.current) return;
      if (speechWatchdogRef.current) {
        window.clearTimeout(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }
      setInitializingMic(false);

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setErrorBanner(
          'Microphone access was denied. Enable microphone permissions in your browser and tap Retry.'
        );
        setMicMuted(true);
        micMutedRef.current = true;
        setOrbState('idle');
        stopRecognition();
      } else if (event.error === 'aborted') {
        speechAbortCountRef.current += 1;
        if (speechAbortCountRef.current >= 2) {
          captureEngineRef.current = 'gemini-audio';
          setCaptureEngine('gemini-audio');
          stopRecognition();
          if (isOpenRef.current && !micMutedRef.current) {
            if (getTranscribeCooldownSeconds() > 0) {
              startListeningRef.current();
            } else {
              void startMicPipeline();
            }
          }
        }
      } else if (
        event.error === 'network' ||
        event.error === 'language-not-supported' ||
        event.error === 'audio-capture'
      ) {
        // Fall back to Gemini Audio transcription (/api/transcribe) if not in cooldown
        captureEngineRef.current = 'gemini-audio';
        setCaptureEngine('gemini-audio');
        stopRecognition();
        if (isOpenRef.current && !micMutedRef.current) {
          if (getTranscribeCooldownSeconds() > 0) {
            startListeningRef.current();
          } else {
            void startMicPipeline();
          }
        }
      } else if (event.error !== 'no-speech') {
        setErrorBanner(`Voice recognition error: ${event.error}`);
        setOrbState('idle');
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setInitializingMic(false);

      if (captureEngineRef.current !== 'speech-api') {
        return;
      }

      const pending = finalBufferRef.current.trim();
      finalBufferRef.current = '';
      if (pending && isOpenRef.current && orbStateRef.current === 'listening') {
        void submitSpokenTurn(pending);
        return;
      }

      if (isOpenRef.current && !micMutedRef.current && orbStateRef.current === 'listening') {
        window.setTimeout(() => {
          if (
            isOpenRef.current &&
            !micMutedRef.current &&
            orbStateRef.current === 'listening' &&
            captureEngineRef.current === 'speech-api'
          ) {
            startListeningRef.current();
          }
        }, 250);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      if (speechWatchdogRef.current) {
        window.clearTimeout(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }
      captureEngineRef.current = 'gemini-audio';
      setCaptureEngine('gemini-audio');
      stopRecognition();
      void startMicPipeline();
    }
  }, [startMicPipeline, stopRecognition, submitSpokenTurn]);

  startListeningRef.current = startListening;

  const stopAllRef = useRef(stopAllActiveTurn);
  const stopRecRef = useRef(stopRecognition);
  const stopMicRef = useRef(stopMicAnalyser);
  stopAllRef.current = stopAllActiveTurn;
  stopRecRef.current = stopRecognition;
  stopMicRef.current = stopMicAnalyser;

  // Strictly depend only on [isOpen] so mid-turn state updates never abort the active session
  useEffect(() => {
    if (!isOpen) {
      stopAllRef.current();
      stopRecRef.current();
      stopMicRef.current();
      setInitializingMic(false);
      setProcessingLabel(null);
      setOrbState('idle');
      return;
    }

    void ensureVoicesLoaded().then((loaded) => {
      if (!isOpenRef.current || settingsRef.current.voiceURI || loaded.length === 0) return;
      const chosen = resolveConsistentVoice(loaded, '', settingsRef.current.voiceLang);
      if (chosen) {
        onUpdateSettingsRef.current({
          ...settingsRef.current,
          voiceURI: chosen.voiceURI,
          voiceLang: chosen.lang || 'en-US',
        });
      }
    });

    const initialEngine: CaptureEngine = getSpeechRecognitionCtor() ? 'speech-api' : 'gemini-audio';
    captureEngineRef.current = initialEngine;
    setCaptureEngine(initialEngine);
    emptyTranscriptCountRef.current = 0;
    speechAbortCountRef.current = 0;
    lastFailedSpeechRef.current = null;
    setUserTranscript('');
    setAssistantTranscript('');
    setErrorBanner(null);
    setVoiceNotice(null);
    setVoiceErrorEngine(null);
    setRetryCooldownSec(getTranscribeCooldownSeconds());
    setProcessingLabel(null);
    setMicMuted(false);
    micMutedRef.current = false;

    const timer = window.setTimeout(() => {
      if (isOpenRef.current) {
        startListeningRef.current();
      }
    }, 50);

    return () => {
      window.clearTimeout(timer);
      if (voiceNoticeTimerRef.current) {
        window.clearTimeout(voiceNoticeTimerRef.current);
        voiceNoticeTimerRef.current = null;
      }
      stopAllRef.current();
      stopRecRef.current();
      stopMicRef.current();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || retryCooldownSec <= 0) return;
    const timer = window.setTimeout(() => {
      setRetryCooldownSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isOpen, retryCooldownSec]);

  const handleInterruptAndListen = useCallback(() => {
    unlockAudioContext();
    stopAllActiveTurn();
    if (micMutedRef.current) {
      setMicMuted(false);
      micMutedRef.current = false;
    }
    startListening();
  }, [startListening, stopAllActiveTurn]);

  const handleToggleMic = useCallback(() => {
    unlockAudioContext();
    if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
      handleInterruptAndListen();
      return;
    }

    if (micMuted) {
      setMicMuted(false);
      micMutedRef.current = false;
      setErrorBanner(null);
      startListening();
    } else {
      setMicMuted(true);
      micMutedRef.current = true;
      stopRecognition();
      stopMicAnalyser();
      setOrbState('idle');
    }
  }, [handleInterruptAndListen, micMuted, startListening, stopMicAnalyser, stopRecognition]);

  const handleToggleSpeaker = useCallback(() => {
    unlockAudioContext();
    const nextMuted = !speakerMuted;
    setSpeakerMuted(nextMuted);
    speakerMutedRef.current = nextMuted;
    if (nextMuted && orbStateRef.current === 'speaking') {
      stopSpeakingAudio();
      if (!micMutedRef.current) {
        startListening();
      } else {
        setOrbState('idle');
      }
    }
  }, [speakerMuted, startListening, stopSpeakingAudio]);

  const handleSendRecordedNow = useCallback(() => {
    unlockAudioContext();
    if (
      orbStateRef.current === 'listening' &&
      captureEngineRef.current === 'gemini-audio' &&
      mediaRecorderRef.current
    ) {
      manualSendRef.current = true;
      stopMediaRecorderOnly(false);
      return;
    }
    if (
      orbStateRef.current === 'listening' &&
      captureEngineRef.current === 'speech-api' &&
      finalBufferRef.current.trim()
    ) {
      const pending = finalBufferRef.current.trim();
      finalBufferRef.current = '';
      void submitSpokenTurn(pending);
    }
  }, [stopMediaRecorderOnly, submitSpokenTurn]);

  const handleOrbClick = useCallback(() => {
    unlockAudioContext();
    if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
      handleInterruptAndListen();
      return;
    }

    // If user is recording via Gemini Audio and taps the core after speaking, send immediately
    if (
      orbStateRef.current === 'listening' &&
      captureEngineRef.current === 'gemini-audio' &&
      mediaRecorderRef.current &&
      (speechDetectedRef.current || recordedChunksRef.current.length > 2)
    ) {
      manualSendRef.current = true;
      stopMediaRecorderOnly(false);
      return;
    }

    handleToggleMic();
  }, [handleInterruptAndListen, handleToggleMic, stopMediaRecorderOnly]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (
        e.code === 'Space' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
          e.preventDefault();
          handleInterruptAndListen();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, handleInterruptAndListen]);

  const handleFallbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioContext();
    const clean = fallbackInput.trim();
    if (!clean) return;
    setFallbackInput('');
    void submitSpokenTurn(clean);
  };

  if (!isOpen) return null;

  const statusLabel = initializingMic
    ? 'Connecting microphone...'
    : processingLabel
      ? processingLabel
      : orbState === 'listening'
        ? 'Listening'
        : orbState === 'thinking'
          ? 'Thinking'
          : orbState === 'speaking'
            ? 'Speaking'
            : micMuted
              ? 'Microphone muted'
              : 'Ready';

  const statusHint = initializingMic
    ? 'Requesting microphone access — allow permission if prompted'
    : orbState === 'speaking'
      ? 'Tap the core or Stop to interrupt'
      : orbState === 'thinking'
        ? processingLabel || 'CHORMO AI is processing'
        : orbState === 'listening'
          ? captureEngine === 'gemini-audio'
            ? 'Speak naturally — pause or tap Send when finished'
            : 'Speak naturally — I will reply automatically'
          : 'Tap the microphone to resume listening';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CHORMO AI Voice Mode"
      className="fixed inset-0 z-50 flex flex-col bg-[#03060f] text-slate-100 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(34,211,238,0.12),rgba(14,165,233,0.06)_40%,transparent_72%)]"
      />

      {/* Top Bar */}
      <header className="relative z-10 h-16 px-5 sm:px-8 flex items-center justify-between gap-4 shrink-0 border-b border-cyan-400/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChromoLogo size="sm" />
          <span className="font-display font-bold text-sm tracking-tight text-sky-50 whitespace-nowrap shrink-0">
            CHORMO AI
          </span>
        </div>

        <div className="flex items-center gap-2 text-center">
          {(initializingMic || orbState === 'thinking') && (
            <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin shrink-0" />
          )}
          <div className="text-xs font-medium tracking-wide text-cyan-300 whitespace-nowrap">
            {statusLabel}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Exit Voice Mode"
          title="Exit Voice Mode"
          className="w-11 h-11 rounded-full border border-cyan-400/20 bg-[#071124]/80 hover:bg-cyan-400/15 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Center Core & Live Conversation Transcript */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-between px-4 pb-4">
        <div className="w-full max-w-[460px] flex-1 min-h-[220px] max-h-[380px] flex flex-col items-center justify-center">
          <VoiceOrbCanvas
            state={orbState}
            audioLevelRef={audioLevelRef}
            onOrbClick={handleOrbClick}
          />
        </div>

        <p className="text-xs text-slate-400 mb-3 text-center px-4">{statusHint}</p>

        {/* Live Conversation Text */}
        <div className="w-full max-w-xl rounded-2xl border border-cyan-400/20 bg-[#071124]/75 backdrop-blur-xl px-5 py-4 space-y-2.5 max-h-[180px] overflow-y-auto shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {errorBanner && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-200 bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2">
              <span className="flex-1 min-w-[180px]">{errorBanner}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {voiceErrorEngine && lastFailedSpeechRef.current ? (
                  <>
                    {voiceErrorEngine === 'cloud-kore' && (
                      <button
                        type="button"
                        onClick={() => {
                          unlockAudioContext();
                          const nextSettings: AppSettings = {
                            ...settingsRef.current,
                            voiceEngine: 'device-locked',
                          };
                          settingsRef.current = nextSettings;
                          onUpdateSettingsRef.current(nextSettings);
                          const pendingText = lastFailedSpeechRef.current;
                          setVoiceErrorEngine(null);
                          setErrorBanner(null);
                          if (pendingText) {
                            void speakResponse(pendingText);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/35 text-cyan-100 font-medium cursor-pointer whitespace-nowrap"
                      >
                        <span>Switch to Locked System Voice</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        unlockAudioContext();
                        const pendingText = lastFailedSpeechRef.current;
                        setVoiceErrorEngine(null);
                        setErrorBanner(null);
                        if (pendingText) {
                          void speakResponse(pendingText);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry Voice</span>
                    </button>
                  </>
                ) : (
                  <>
                    {speechApiAvailable && captureEngine === 'gemini-audio' && (
                      <button
                        type="button"
                        onClick={() => {
                          unlockAudioContext();
                          captureEngineRef.current = 'speech-api';
                          setCaptureEngine('speech-api');
                          speechAbortCountRef.current = 0;
                          setErrorBanner(null);
                          setMicMuted(false);
                          micMutedRef.current = false;
                          startListening();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/35 text-cyan-100 font-medium cursor-pointer"
                      >
                        <span>Use Browser Voice</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={retryCooldownSec > 0 && captureEngine === 'gemini-audio'}
                      onClick={() => {
                        unlockAudioContext();
                        emptyTranscriptCountRef.current = 0;
                        setErrorBanner(null);
                        setMicMuted(false);
                        micMutedRef.current = false;
                        startListening();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>
                        {retryCooldownSec > 0 && captureEngine === 'gemini-audio'
                          ? `Wait ${retryCooldownSec}s`
                          : 'Retry'}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {voiceNotice && !errorBanner && (
            <div className="text-xs text-cyan-200/90 bg-cyan-500/10 border border-cyan-400/20 rounded-xl px-3 py-2 text-center">
              {voiceNotice}
            </div>
          )}

          {!userTranscript && !assistantTranscript && !errorBanner && !voiceNotice && (
            <p className="text-sm text-slate-400 text-center">
              {initializingMic
                ? 'Initializing voice core...'
                : 'Say hello to start a natural voice conversation with CHORMO AI.'}
            </p>
          )}

          {userTranscript && (
            <div className="text-sm leading-relaxed text-slate-200 flex items-center gap-2">
              <span className="text-xs font-medium text-cyan-300 shrink-0">You</span>
              <span>{userTranscript}</span>
            </div>
          )}

          {assistantTranscript && (
            <div className="text-[14.5px] leading-relaxed text-white">
              <span className="text-xs font-medium text-sky-300 mr-2">CHORMO</span>
              <span>{assistantTranscript}</span>
            </div>
          )}
        </div>

        {/* Fallback text input when microphone/recorder is unavailable, errored, or cooling down */}
        {(!recorderSupported || errorBanner || retryCooldownSec > 0) && (
          <form
            onSubmit={handleFallbackSubmit}
            className="mt-3 w-full max-w-xl flex items-center gap-2 px-3 py-1.5 rounded-xl border border-cyan-400/20 bg-[#071124]/80"
          >
            <input
              type="text"
              value={fallbackInput}
              onChange={(e) => setFallbackInput(e.target.value)}
              placeholder="Type here to talk with CHORMO AI..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none py-1.5"
            />
            <button
              type="submit"
              disabled={!fallbackInput.trim() || orbState === 'thinking'}
              aria-label="Send message"
              className="w-9 h-9 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 text-[#03060f] flex items-center justify-center cursor-pointer"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {/* Bottom Controls Dock */}
      <footer className="relative z-10 px-4 pb-7 pt-2 flex items-center justify-center gap-4 shrink-0">
        <button
          type="button"
          onClick={handleToggleSpeaker}
          aria-label={speakerMuted ? 'Unmute AI voice' : 'Mute AI voice'}
          title={speakerMuted ? 'Unmute AI voice' : 'Mute AI voice'}
          className={[
            'w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer',
            speakerMuted
              ? 'border-slate-500/40 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
              : 'border-cyan-400/25 bg-[#071124]/80 text-slate-200 hover:bg-cyan-400/15',
          ].join(' ')}
        >
          {speakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={handleToggleMic}
          aria-label={
            orbState === 'speaking' || orbState === 'thinking'
              ? 'Interrupt and speak'
              : micMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
          }
          title={
            orbState === 'speaking' || orbState === 'thinking'
              ? 'Interrupt and speak'
              : micMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
          }
          className={[
            'w-16 h-16 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-lg',
            orbState === 'listening' && !micMuted
              ? 'border-cyan-300/70 bg-gradient-to-br from-cyan-400 to-sky-500 text-[#03060f] shadow-[0_0_28px_rgba(34,211,238,0.45)]'
              : micMuted
                ? 'border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                : 'border-cyan-400/30 bg-[#071124]/90 text-white hover:bg-cyan-400/15',
          ].join(' ')}
        >
          {initializingMic ? (
            <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
          ) : micMuted && orbState !== 'speaking' && orbState !== 'thinking' ? (
            <MicOff className="w-6 h-6" />
          ) : (
            <Mic className="w-6 h-6" />
          )}
        </button>

        {orbState === 'speaking' || orbState === 'thinking' ? (
          <button
            type="button"
            onClick={handleInterruptAndListen}
            aria-label="Stop speaking"
            title="Stop speaking"
            className="h-12 px-4 rounded-full border border-cyan-400/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-100 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        ) : orbState === 'listening' && captureEngine === 'gemini-audio' && hasRecordedAudio ? (
          <button
            type="button"
            onClick={handleSendRecordedNow}
            aria-label="Send voice message now"
            title="Send voice message now"
            className="h-12 px-4 rounded-full border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="End voice session"
            title="End voice session"
            className="w-12 h-12 rounded-full border border-cyan-400/25 bg-[#071124]/80 hover:bg-red-500/20 hover:border-red-400/40 text-slate-200 hover:text-red-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </footer>
    </div>
  );
}
