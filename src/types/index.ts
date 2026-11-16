export type SupportedLanguage = 
  | 'fa' // Persian
  | 'en' // English
  | 'es' // Spanish
  | 'fr' // French
  | 'de' // German
  | 'ja' // Japanese
  | 'zh' // Chinese
  | 'ar' // Arabic
  | 'ru' // Russian
  | 'tr' // Turkish
  | 'hi' // Hindi
  | 'it'; // Italian

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
];

export type VoiceGender = 'FEMALE' | 'MALE' | 'NEUTRAL';
export type AppMode = 'video' | 'meeting';

export interface GeminiModelOption {
  id: string;
  name: string;
  tier: 'account';
  badge: string;
  description: string;
  latency: 'Ultra-Fast' | 'Fast' | 'Standard';
  recommended?: boolean;
}

export const AVAILABLE_GEMINI_MODELS: GeminiModelOption[] = [
  { id: 'gemini-flash-lite-latest', name: 'Gemini Flash-Lite (Latest)', tier: 'account', badge: 'CHECK ACCOUNT QUOTA', description: 'Low-latency translation. Availability and pricing depend on your Google account.', latency: 'Fast', recommended: true },
];

export const LIVE_MODELS = [
  { id: 'gemini-3.5-live-translate-preview', name: 'Gemini 3.5 Live Translate', kind: 'translate', description: 'Recommended for continuous translated speech.' },
  { id: 'gemini-2.5-flash-native-audio-preview-12-2025', name: 'Gemini 2.5 Flash Native Audio Dialog', kind: 'dialog', description: 'Native audio with interpreter instructions.' },
  { id: 'gemini-3.1-flash-live-preview', name: 'Gemini 3 Flash Live (3.1 preview)', kind: 'dialog', description: 'Google’s documented Flash Live preview model ID.' },
  { id: 'gemini-3.5-transcribe-live', name: 'Gemini 3.5 Transcribe Live', kind: 'transcribe', description: 'Source-language captions only; no translation or dubbed voice.' },
  { id: 'gemini-3.8-live', name: 'Gemini 3.8 Live', kind: 'dialog', description: 'Native audio with interpreter instructions.' },
  { id: 'gemini-3.8-live-extended-thinking', name: 'Gemini 3.8 Live Extended Thinking', kind: 'dialog', description: 'Reasoning-oriented; may add latency to dubbing.' },
] as const;

export interface UserSettings {
  engine: 'gemini_live' | 'http';
  liveModel: string;
  googleApiKey: string;
  geminiModel: string;
  sourceLanguage: string; // 'auto' or code
  targetLanguage: SupportedLanguage;
  voiceGender: VoiceGender;
  voiceSpeed: number; // 0.8 to 1.5
  duckingLevel: number; // 0.0 to 1.0 (e.g. 0.15 = original audio dropped to 15%)
  subtitlesEnabled: boolean;
  bilingualSubtitles: boolean;
  mode: AppMode;
  audioBufferSizeMs: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  engine: 'gemini_live',
  liveModel: 'gemini-3.5-live-translate-preview',
  googleApiKey: '',
  geminiModel: 'gemini-flash-lite-latest',
  sourceLanguage: 'auto',
  targetLanguage: 'fa',
  voiceGender: 'FEMALE',
  voiceSpeed: 1.0,
  duckingLevel: 0.18,
  subtitlesEnabled: true,
  bilingualSubtitles: true,
  mode: 'video',
  audioBufferSizeMs: 2500,
};

export interface TranscriptItem {
  id: string;
  timestamp: number;
  sessionId?: string;
  kind?: 'transcription' | 'translation';
  startMs?: number;
  endMs?: number;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}

export type DubbingStatus = 'idle' | 'initializing' | 'listening' | 'dubbing' | 'error';

export interface DubbingState {
  status: DubbingStatus;
  activeTabId?: number;
  errorMessage?: string;
  currentOriginalText?: string;
  currentTranslatedText?: string;
  audioLevel: number; // 0 - 100 for visualizer
  isDucking: boolean;
  stats: {
    latencyMs: number;
    sentencesDubbed: number;
    bytesProcessed: number;
  };
}

export type ExtensionMessage =
  | { type: 'START_DUBBING'; tabId?: number }
  | { type: 'START_DUBBING_WITH_STREAM'; streamId: string; tabId: number }
  | { type: 'STOP_DUBBING' }
  | { type: 'GET_STATE' }
  | { type: 'STATE_CHANGED'; state: DubbingState }
  | { type: 'NEW_TRANSCRIPT'; item: TranscriptItem }
  | { type: 'AUDIO_LEVEL'; level: number; isDucking: boolean }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<UserSettings> }
  | { type: 'SETTINGS_UPDATED'; settings: UserSettings }
  | { type: 'TOGGLE_SUBTITLES'; enabled: boolean }
  | { type: 'OPEN_SIDEPANEL' }
  | { type: 'FALLBACK_SPEECH_ENDED' }
  | { type: 'TEST_API_KEY'; apiKey: string }
  | { type: 'TEST_API_KEY_RESULT'; success: boolean; message: string };
