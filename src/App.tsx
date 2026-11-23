import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AudioLines, PanelLeftOpen, SquarePen } from 'lucide-react';
import { BackgroundAmbience } from './components/BackgroundAmbience';
import { ChatMessageItem } from './components/ChatMessageItem';
import { ChromoLogo } from './components/ChromoLogo';
import { Composer } from './components/Composer';
import { DigitalHeartCore } from './components/DigitalHeartCore';
import { ImageGenerator } from './components/ImageGenerator';
import { ProfileModal } from './components/ProfileModal';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { VoiceMode } from './components/VoiceMode';
import {
  cleanTextForSpeech,
  getSupportedAudioMimeType,
  getTranscribeCooldownSeconds,
  selectBestFemaleVoice,
  transcribeAudioBlob,
  unlockAudioContext,
} from './utils/voiceSpeech';
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
} from './types/chat';
import type {
  AIState,
  AppSettings,
  ChatMessage,
  Conversation,
  ModelOption,
  UserProfile,
} from './types/chat';

const STORAGE_KEYS = {
  CHATS: 'chromo_ai_chats_v1',
  ACTIVE_ID: 'chromo_ai_active_id_v1',
  MODEL: 'chromo_ai_model_v1',
  SETTINGS: 'chormo_ai_settings_v1',
  PROFILE: 'chormo_ai_profile_v1',
};

const STARTER_PROMPTS = [
  {
    label: 'Explain clearly',
    title: 'How quantum error correction works in simple terms',
    prompt: 'Explain how quantum error correction works in 4 concise, clear sentences.',
  },
  {
    label: 'Write code',
    title: 'TypeScript debounce helper with clean usage example',
    prompt: 'Write a clean TypeScript debounce utility function with a short usage example.',
  },
  {
    label: 'Draft message',
    title: 'Concise follow-up email after a product interview',
    prompt: 'Draft a concise, thoughtful follow-up email after a product engineering interview.',
  },
  {
    label: 'Brainstorm',
    title: '5 practical habits for shipping better software faster',
    prompt: 'Share 5 focused, practical habits for shipping reliable software faster.',
  },
];

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
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
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const AI_STATE_LABEL: Record<AIState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  responding: 'Responding',
};

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CHATS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);
    } catch {
      return null;
    }
  });

  // Backend model ID preserved internally; no provider or model selector exposed in UI
  const [model] = useState<ModelOption['id']>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MODEL);
      if (MODEL_OPTIONS.some((m) => m.id === saved)) {
        return saved as ModelOption['id'];
      }
    } catch {
      // Ignore storage error
    }
    return 'gemini-3.1-flash-lite';
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (!raw) return DEFAULT_PROFILE;
      return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) };
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  const [input, setInput] = useState('');
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [imageCreatorOpen, setImageCreatorOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const dictationWatchdogRef = useRef<number | null>(null);
  const ttsWatchdogRef = useRef<number | null>(null);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationAudioCtxRef = useRef<AudioContext | null>(null);
  const dictationRafRef = useRef<number>(0);
  const audioLevelRef = useRef<number>(0);
  const noticeTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<Conversation[]>(conversations);
  conversationsRef.current = conversations;
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const voiceSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      Boolean(getSpeechRecognitionCtor()) ||
      (typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia))
    );
  }, []);

  const showNotice = useCallback((msg: string, duration = 3500) => {
    setNotice(msg);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, duration);
  }, []);

  const activeConversation = useMemo(() => {
    if (!activeId) return conversations[0] || null;
    return conversations.find((c) => c.id === activeId) || conversations[0] || null;
  }, [conversations, activeId]);

  const activeIdRef = useRef<string | null>(activeConversation?.id || null);
  activeIdRef.current = activeConversation?.id || null;

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(conversations));
      if (activeConversation?.id) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, activeConversation.id);
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
      }
    } catch {
      // Ignore quota errors
    }
  }, [conversations, activeConversation?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
    } catch {
      // Ignore storage errors
    }
  }, [profile]);

  const stopMicLevelMonitor = useCallback(() => {
    if (dictationRafRef.current) {
      window.cancelAnimationFrame(dictationRafRef.current);
      dictationRafRef.current = 0;
    }
    if (dictationAudioCtxRef.current && dictationAudioCtxRef.current.state !== 'closed') {
      dictationAudioCtxRef.current.close().catch(() => {});
      dictationAudioCtxRef.current = null;
    }
    audioLevelRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      recognitionRef.current?.stop();
      if (dictationRecorderRef.current && dictationRecorderRef.current.state !== 'inactive') {
        try {
          dictationRecorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      dictationStreamRef.current?.getTracks().forEach((t) => t.stop());
      stopMicLevelMonitor();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopMicLevelMonitor]);

  const scrollToBottom = useCallback(() => {
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages.length, isStreaming, scrollToBottom]);

  const stopSpeech = useCallback(() => {
    if (ttsWatchdogRef.current) {
      window.clearTimeout(ttsWatchdogRef.current);
      ttsWatchdogRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }, []);

  const openVoiceMode = useCallback(() => {
    stopSpeech();
    unlockAudioContext();
    setVoiceModeOpen(true);
  }, [stopSpeech]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const speakMessageText = useCallback(
    (msgId: string, content: string) => {
      if (!ttsSupported) return;
      if (ttsWatchdogRef.current) {
        window.clearTimeout(ttsWatchdogRef.current);
        ttsWatchdogRef.current = null;
      }
      window.speechSynthesis.cancel();
      const clean = cleanTextForSpeech(content);
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      const femaleVoice = selectBestFemaleVoice(window.speechSynthesis.getVoices());
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }
      utterance.rate = settingsRef.current.speechRate || 1.0;
      utterance.pitch = 1.04;

      const clearSpeaking = () => {
        if (ttsWatchdogRef.current) {
          window.clearTimeout(ttsWatchdogRef.current);
          ttsWatchdogRef.current = null;
        }
        setSpeakingMessageId((curr) => (curr === msgId ? null : curr));
      };

      utterance.onend = clearSpeaking;
      utterance.onerror = clearSpeaking;

      // Safety timeout so browser speechSynthesis bugs cannot trap UI in Speaking state
      const maxMs = Math.max(5000, clean.length * 90 + 3000);
      ttsWatchdogRef.current = window.setTimeout(clearSpeaking, maxMs);

      setSpeakingMessageId(msgId);
      window.speechSynthesis.speak(utterance);
    },
    [ttsSupported]
  );

  const handleToggleSpeak = useCallback(
    (msg: ChatMessage) => {
      if (!ttsSupported) {
        showNotice('Text-to-speech is not supported in this browser.');
        return;
      }

      if (speakingMessageId === msg.id) {
        stopSpeech();
        return;
      }

      speakMessageText(msg.id, msg.content);
    },
    [ttsSupported, speakingMessageId, stopSpeech, speakMessageText, showNotice]
  );

  const startMicLevelMonitor = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      dictationAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!dictationAudioCtxRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const n = (data[i] - 128) / 128;
          sumSq += n * n;
        }
        const rms = Math.sqrt(sumSq / data.length);
        audioLevelRef.current = Math.min(1, rms * 4.5);
        dictationRafRef.current = window.requestAnimationFrame(tick);
      };
      dictationRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      // Ignore AudioContext restrictions
    }
  }, []);

  const startAudioDictationFallback = useCallback(
    async (baseText: string) => {
      const cooldown = getTranscribeCooldownSeconds();
      if (cooldown > 0) {
        showNotice(`Voice usage limit reached. Please wait ${cooldown}s or type your message.`, 5500);
        return;
      }

      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        showNotice('Voice dictation is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        dictationStreamRef.current = stream;
        startMicLevelMonitor(stream);
        const mimeType = getSupportedAudioMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
            : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
        } catch {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        }
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          setIsListening(false);
          dictationRecorderRef.current = null;
          stopMicLevelMonitor();
          dictationStreamRef.current?.getTracks().forEach((t) => t.stop());
          dictationStreamRef.current = null;

          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          if (blob.size < 1200) return;

          showNotice('Transcribing speech…', 6000);
          const { transcript, error, rateLimited } = await transcribeAudioBlob(blob);
          if (error) {
            showNotice(error, rateLimited ? 5500 : 4000);
          } else if (transcript) {
            setInput(baseText ? `${baseText} ${transcript}` : transcript);
            showNotice('Transcribed.', 1500);
          } else {
            showNotice('No speech detected.', 2000);
          }
        };

        dictationRecorderRef.current = recorder;
        recorder.start(250);
        setIsListening(true);
        showNotice('Listening… tap mic again when finished', 10000);
      } catch (err) {
        setIsListening(false);
        stopMicLevelMonitor();
        const e = err as { name?: string };
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
          showNotice('Microphone access was denied. Enable permissions in your browser settings.');
        } else {
          showNotice('Could not start microphone recording.');
        }
      }
    },
    [showNotice, startMicLevelMonitor, stopMicLevelMonitor]
  );

  const handleToggleVoice = useCallback(() => {
    unlockAudioContext();

    if (isListening && dictationRecorderRef.current) {
      dictationRecorderRef.current.stop();
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const baseText = input.trim();
    const SpeechRec = getSpeechRecognitionCtor();
    if (!SpeechRec) {
      void startAudioDictationFallback(baseText);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    let started = false;
    if (dictationWatchdogRef.current) {
      window.clearTimeout(dictationWatchdogRef.current);
    }
    dictationWatchdogRef.current = window.setTimeout(() => {
      if (!started && recognitionRef.current === recognition) {
        try {
          recognition.stop();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
        setIsListening(false);
        void startAudioDictationFallback(baseText);
      }
    }, 1800);

    recognition.onstart = () => {
      started = true;
      if (dictationWatchdogRef.current) {
        window.clearTimeout(dictationWatchdogRef.current);
        dictationWatchdogRef.current = null;
      }
      setIsListening(true);
      recognitionRef.current = recognition;
      showNotice('Listening… speak now', 5000);
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(baseText ? `${baseText} ${transcript}` : transcript);
    };

    recognition.onerror = (event) => {
      if (dictationWatchdogRef.current) {
        window.clearTimeout(dictationWatchdogRef.current);
        dictationWatchdogRef.current = null;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setIsListening(false);
        showNotice('Microphone access was denied. Enable permissions in your browser settings.');
      } else if (
        event.error === 'network' ||
        event.error === 'audio-capture' ||
        event.error === 'language-not-allowed'
      ) {
        recognitionRef.current = null;
        setIsListening(false);
        void startAudioDictationFallback(baseText);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setIsListening(false);
        showNotice(`Voice input error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (dictationWatchdogRef.current) {
        window.clearTimeout(dictationWatchdogRef.current);
        dictationWatchdogRef.current = null;
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      if (dictationWatchdogRef.current) {
        window.clearTimeout(dictationWatchdogRef.current);
        dictationWatchdogRef.current = null;
      }
      recognitionRef.current = null;
      void startAudioDictationFallback(baseText);
    }
  }, [isListening, input, showNotice, startAudioDictationFallback]);

  const streamReply = useCallback(
    async (chatId: string, historyForServer: Array<{ role: string; content: string }>) => {
      stopSpeech();

      const assistantMsgId = createId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        error: null,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, updatedAt: Date.now(), messages: [...c.messages, assistantPlaceholder] }
            : c
        )
      );

      setIsStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: historyForServer,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          throw new Error(errPayload.error || `Request failed (${res.status})`);
        }

        if (!res.body) {
          throw new Error('Streaming response unavailable.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

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
              };

              if (parsed.type === 'delta' && parsed.text) {
                accumulated += parsed.text;
                const currentText = accumulated;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === chatId
                      ? {
                          ...c,
                          updatedAt: Date.now(),
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, content: currentText } : m
                          ),
                        }
                      : c
                  )
                );
                scrollToBottom();
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message || 'Failed to generate a response.');
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
          throw new Error('Empty response received. Please try regenerating.');
        }

        if (settingsRef.current.autoSpeakResponses) {
          speakMessageText(assistantMsgId, accumulated);
        }
      } catch (err) {
        const errorObj = err as { name?: string; message?: string };
        if (errorObj?.name === 'AbortError') {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const target = c.messages.find((m) => m.id === assistantMsgId);
              if (target && !target.content.trim()) {
                return {
                  ...c,
                  messages: c.messages.filter((m) => m.id !== assistantMsgId),
                };
              }
              return c;
            })
          );
        } else {
          const messageText =
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'You appear to be offline. Reconnect and try again.'
              : errorObj?.message || 'Unable to generate a response right now.';

          setConversations((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    updatedAt: Date.now(),
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, error: messageText } : m
                    ),
                  }
                : c
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [model, stopSpeech, scrollToBottom, speakMessageText]
  );

  const sendPrompt = useCallback(
    async (promptText: string) => {
      const clean = promptText.trim();
      if (!clean || isStreaming) return;

      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: clean,
      };

      let targetChatId = activeConversation?.id;
      let nextHistory: Array<{ role: string; content: string }> = [];

      if (!targetChatId) {
        targetChatId = createId();
        const newChat: Conversation = {
          id: targetChatId,
          title: clean.length > 44 ? `${clean.slice(0, 44)}…` : clean,
          updatedAt: Date.now(),
          messages: [userMsg],
        };
        setConversations((prev) => [newChat, ...prev]);
        setActiveId(targetChatId);
        nextHistory = [{ role: 'user', content: clean }];
      } else {
        const existing = conversations.find((c) => c.id === targetChatId);
        const existingMessages = existing?.messages || [];
        const updatedTitle =
          existingMessages.length === 0
            ? clean.length > 44
              ? `${clean.slice(0, 44)}…`
              : clean
            : existing?.title || 'New conversation';

        nextHistory = [...existingMessages, userMsg]
          .filter((m) => !m.error && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  title: updatedTitle,
                  updatedAt: Date.now(),
                  messages: [...c.messages, userMsg],
                }
              : c
          )
        );
      }

      setInput('');
      await streamReply(targetChatId, nextHistory);
    },
    [isStreaming, activeConversation?.id, conversations, streamReply]
  );

  const handleVoiceTurn = useCallback(
    async (
      userText: string,
      onStreamDelta: (partialResponse: string) => void,
      signal: AbortSignal
    ): Promise<{ text: string; error?: string | null }> => {
      const clean = userText.trim();
      if (!clean) return { text: '', error: 'Empty message.' };

      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: clean,
      };
      const assistantMsgId = createId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        error: null,
      };

      let targetChatId = activeIdRef.current;
      let nextHistory: Array<{ role: string; content: string }> = [];

      if (!targetChatId) {
        targetChatId = createId();
        const newChat: Conversation = {
          id: targetChatId,
          title: clean.length > 44 ? `${clean.slice(0, 44)}…` : clean,
          updatedAt: Date.now(),
          messages: [userMsg, assistantPlaceholder],
        };
        conversationsRef.current = [newChat, ...conversationsRef.current];
        activeIdRef.current = targetChatId;
        setConversations(conversationsRef.current);
        setActiveId(targetChatId);
        nextHistory = [{ role: 'user', content: clean }];
      } else {
        const existing = conversationsRef.current.find((c) => c.id === targetChatId);
        const existingMessages = existing?.messages || [];
        const updatedTitle =
          existingMessages.length === 0
            ? clean.length > 44
              ? `${clean.slice(0, 44)}…`
              : clean
            : existing?.title || 'New conversation';

        nextHistory = [...existingMessages, userMsg]
          .filter((m) => !m.error && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  title: updatedTitle,
                  updatedAt: Date.now(),
                  messages: [...c.messages, userMsg, assistantPlaceholder],
                }
              : c
          )
        );
      }

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model,
            messages: nextHistory,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          throw new Error(errPayload.error || `Request failed (${res.status})`);
        }
        if (!res.body) {
          throw new Error('Streaming response unavailable.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

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
              };

              if (parsed.type === 'delta' && parsed.text) {
                accumulated += parsed.text;
                const currentText = accumulated;
                onStreamDelta(currentText);
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === targetChatId
                      ? {
                          ...c,
                          updatedAt: Date.now(),
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, content: currentText } : m
                          ),
                        }
                      : c
                  )
                );
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message || 'Failed to generate a response.');
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
          throw new Error('Empty response received. Please try again.');
        }

        return { text: accumulated };
      } catch (err) {
        const errorObj = err as { name?: string; message?: string };
        if (errorObj?.name === 'AbortError') {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.filter(
                      (m) => m.id !== assistantMsgId || m.content.trim().length > 0
                    ),
                  }
                : c
            )
          );
          return { text: '' };
        }

        const errMsg =
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'You appear to be offline. Reconnect and try again.'
            : errorObj?.message || 'Unable to generate a response right now.';

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, error: errMsg } : m
                  ),
                }
              : c
          )
        );
        return { text: '', error: errMsg };
      }
    },
    [model]
  );

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || !activeConversation) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    const trimmed =
      msgs[msgs.length - 1].role === 'assistant' ? msgs.slice(0, -1) : msgs;

    const historyForServer = trimmed
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    if (historyForServer.length === 0) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? { ...c, updatedAt: Date.now(), messages: trimmed }
          : c
      )
    );

    await streamReply(activeConversation.id, historyForServer);
  }, [isStreaming, activeConversation, streamReply]);

  const handleNewChat = useCallback(() => {
    stopStreaming();
    stopSpeech();
    setMobileSidebarOpen(false);

    if (activeConversation && activeConversation.messages.length === 0) {
      return;
    }

    const newChat: Conversation = {
      id: createId(),
      title: 'New conversation',
      updatedAt: Date.now(),
      messages: [],
    };
    setConversations((prev) => [newChat, ...prev]);
    setActiveId(newChat.id);
  }, [activeConversation, stopStreaming, stopSpeech]);

  const handleSelectChat = useCallback(
    (id: string) => {
      if (id === activeConversation?.id) return;
      stopStreaming();
      stopSpeech();
      setActiveId(id);
    },
    [activeConversation?.id, stopStreaming, stopSpeech]
  );

  const handleDeleteChat = useCallback(
    (id: string) => {
      if (id === activeConversation?.id) {
        stopStreaming();
        stopSpeech();
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (id === activeConversation?.id) {
          setActiveId(remaining[0]?.id || null);
        }
        return remaining;
      });
    },
    [activeConversation?.id, stopStreaming, stopSpeech]
  );

  const handleClearHistory = useCallback(() => {
    stopStreaming();
    stopSpeech();
    setConversations([]);
    setActiveId(null);
    showNotice('Conversation history cleared.');
  }, [stopStreaming, stopSpeech, showNotice]);

  const messages = activeConversation?.messages || [];

  const totalMessageCount = useMemo(
    () => conversations.reduce((sum, c) => sum + c.messages.length, 0),
    [conversations]
  );

  const aiState: AIState = useMemo(() => {
    if (isListening) return 'listening';
    if (isStreaming) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        return 'thinking';
      }
      return 'responding';
    }
    if (speakingMessageId) return 'responding';
    return 'idle';
  }, [isListening, isStreaming, messages, speakingMessageId]);

  return (
    <div className="relative flex h-dvh overflow-x-hidden overflow-y-hidden bg-[#03060f] text-slate-100">
      <BackgroundAmbience
        gridEnabled={settings.gridEnabled}
        particlesEnabled={settings.particlesEnabled}
        scanlineEnabled={settings.scanlineEnabled}
      />

      <Sidebar
        conversations={conversations}
        activeId={activeConversation?.id || null}
        profile={profile}
        desktopOpen={desktopSidebarOpen}
        mobileOpen={mobileSidebarOpen}
        onCloseDesktop={() => setDesktopSidebarOpen(false)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onOpenImageCreator={() => setImageCreatorOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <main className="relative z-10 flex-1 min-w-0 flex flex-col">
        {/* Top Futuristic HUD Bar */}
        <header className="h-14 px-3 sm:px-5 flex items-center justify-between gap-4 border-b border-cyan-400/12 bg-[#040917]/65 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileSidebarOpen(true);
                } else {
                  setDesktopSidebarOpen(true);
                }
              }}
              aria-label="Open sidebar"
              title="Open sidebar"
              className={[
                'w-10 h-10 rounded-xl items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer',
                desktopSidebarOpen ? 'flex md:hidden' : 'flex',
              ].join(' ')}
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>

            <div
              className={[
                'items-center gap-2',
                desktopSidebarOpen ? 'flex md:hidden' : 'flex',
              ].join(' ')}
            >
              <ChromoLogo size="sm" />
              <span className="font-display font-bold text-sm tracking-tight text-sky-50 whitespace-nowrap shrink-0">
                CHORMO AI
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-center gap-2.5">
            {messages.length > 0 && (
              <div className="hidden sm:flex items-center">
                <DigitalHeartCore
                  state={aiState}
                  audioLevelRef={audioLevelRef}
                  size="compact"
                  onClick={openVoiceMode}
                  ariaLabel="Open Voice Mode"
                />
              </div>
            )}
            <h1 className="text-[13px] font-medium text-slate-300 truncate max-w-[240px] sm:max-w-[340px]">
              {messages.length > 0
                ? activeConversation?.title || 'Active Session'
                : 'CHORMO AI'}
            </h1>
            {messages.length > 0 && aiState !== 'idle' && (
              <span className="hidden md:inline text-xs font-medium text-cyan-300 whitespace-nowrap shrink-0">
                <span aria-hidden="true" className="mr-1.5 text-slate-500">·</span>
                {AI_STATE_LABEL[aiState]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={openVoiceMode}
              aria-label="Open Voice Mode"
              title="Open Voice Mode"
              className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-cyan-200 bg-cyan-500/12 border border-cyan-400/25 hover:bg-cyan-500/22 hover:border-cyan-300/45 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <AudioLines className="w-4 h-4 text-cyan-300" />
              <span className="hidden sm:inline">Voice Mode</span>
            </button>

            <button
              type="button"
              onClick={handleNewChat}
              aria-label="New chat"
              title="New chat"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
            >
              <SquarePen className="w-[18px] h-[18px]" />
            </button>
          </div>
        </header>

        {/* Central Viewport */}
        <section
          ref={viewportRef}
          aria-live="polite"
          className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 py-4 sm:py-6 scroll-smooth"
        >
          <div className="max-w-[780px] mx-auto min-h-full flex flex-col">
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="my-auto py-4 sm:py-6 flex flex-col items-center text-center"
              >
                {/* Central Digital AI Heart */}
                <div className="relative w-48 h-48 sm:w-64 sm:h-64 md:w-[280px] md:h-[280px] chormo-float">
                  <DigitalHeartCore
                    state={aiState}
                    audioLevelRef={audioLevelRef}
                    size="hero"
                    onClick={openVoiceMode}
                    ariaLabel="Activate CHORMO AI Voice Mode"
                  />
                </div>

                {/* Clean AI State Indicator & Identity */}
                <div className="mt-2 flex items-center justify-center gap-2 text-xs font-medium text-cyan-300">
                  <span>{AI_STATE_LABEL[aiState]}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-slate-400">Tap core for voice</span>
                </div>

                <h2 className="mt-3 font-display text-2xl sm:text-[32px] font-semibold tracking-tight text-white text-balance">
                  How can I assist you, {profile.name}?
                </h2>

                <p className="mt-1.5 text-sm text-slate-400 max-w-md">
                  {profile.greetingNote}
                </p>

                {/* Quick Starter Commands */}
                <div className="mt-7 w-full grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[640px] text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => sendPrompt(item.prompt)}
                      className="group p-4 rounded-2xl border border-cyan-400/15 bg-[#071124]/60 backdrop-blur-xl hover:bg-[#0b1936]/80 hover:border-cyan-400/40 hover:shadow-[0_0_24px_rgba(34,211,238,0.12)] transition-all duration-150 cursor-pointer"
                    >
                      <div className="text-xs font-medium text-cyan-300 group-hover:text-cyan-200 transition-colors">
                        {item.label}
                      </div>
                      <div className="mt-1 text-[13.5px] leading-snug text-slate-300 group-hover:text-white transition-colors">
                        {item.title}
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <div className="space-y-6 pb-4">
                {messages.map((msg, idx) => (
                  <ChatMessageItem
                    key={msg.id}
                    message={msg}
                    isLast={idx === messages.length - 1}
                    isStreaming={isStreaming}
                    isSpeaking={speakingMessageId === msg.id}
                    ttsSupported={ttsSupported}
                    onToggleSpeak={handleToggleSpeak}
                    onRegenerate={handleRegenerate}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Floating Glass Composer */}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => sendPrompt(input)}
          onStop={stopStreaming}
          onToggleVoice={handleToggleVoice}
          onOpenVoiceMode={openVoiceMode}
          onOpenImageCreator={() => setImageCreatorOpen(true)}
          isStreaming={isStreaming}
          isListening={isListening}
          voiceSupported={voiceSupported}
          notice={notice}
        />
      </main>

      <VoiceMode
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        onSendTurn={handleVoiceTurn}
      />

      <ImageGenerator
        isOpen={imageCreatorOpen}
        onClose={() => setImageCreatorOpen(false)}
      />

      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        conversationCount={conversations.length}
        onUpdateSettings={setSettings}
        onClearHistory={handleClearHistory}
        onClose={() => setSettingsOpen(false)}
      />

      <ProfileModal
        isOpen={profileOpen}
        profile={profile}
        conversationCount={conversations.length}
        messageCount={totalMessageCount}
        onSaveProfile={setProfile}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}
