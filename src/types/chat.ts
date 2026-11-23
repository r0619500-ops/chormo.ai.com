export type ChatRole = 'user' | 'assistant';

export type AIState = 'idle' | 'listening' | 'thinking' | 'responding';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  error?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ModelOption {
  id: 'gemini-3.1-flash-lite';
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini-3.1-flash-lite', label: 'CHORMO Core' },
];

export type VoiceEngineMode = 'device-locked' | 'cloud-kore';

export interface AppSettings {
  gridEnabled: boolean;
  particlesEnabled: boolean;
  scanlineEnabled: boolean;
  autoSpeakResponses: boolean;
  voiceEngine: VoiceEngineMode;
  voiceURI: string;
  voiceLang: string;
  speechRate: number;
  speechPitch: number;
}

export interface UserProfile {
  name: string;
  role: string;
  greetingNote: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  gridEnabled: true,
  particlesEnabled: true,
  scanlineEnabled: true,
  autoSpeakResponses: false,
  voiceEngine: 'device-locked',
  voiceURI: '',
  voiceLang: 'en-US',
  speechRate: 1.0,
  speechPitch: 1.0,
};

export const DEFAULT_PROFILE: UserProfile = {
  name: 'Operator',
  role: 'Primary Access',
  greetingNote: 'Ready for your next command or question.',
};
