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
export type DubbingEngine = 'gemini_live' | 'google_cloud_pipeline';

export interface UserSettings {
  googleApiKey: string;
  geminiModel: string;
  sourceLanguage: string; // 'auto' or code
  targetLanguage: SupportedLanguage;
  voiceGender: VoiceGender;
  voiceSpeed: number; // 0.8 to 1.5
  duckingLevel: number; // 0.0 to 1.0 (e.g. 0.15 = original audio dropped to 15%)
  subtitlesEnabled: boolean;
  bilingualSubtitles: boolean;
  dubbingEngine: DubbingEngine;
  mode: AppMode;
  audioBufferSizeMs: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  googleApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  sourceLanguage: 'auto',
  targetLanguage: 'fa',
  voiceGender: 'FEMALE',
  voiceSpeed: 1.0,
  duckingLevel: 0.18,
  subtitlesEnabled: true,
  bilingualSubtitles: true,
  dubbingEngine: 'google_cloud_pipeline',
  mode: 'video',
  audioBufferSizeMs: 2500,
};

export interface TranscriptItem {
  id: string;
  timestamp: number;
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
  | { type: 'STOP_DUBBING' }
  | { type: 'GET_STATE' }
  | { type: 'STATE_CHANGED'; state: DubbingState }
  | { type: 'NEW_TRANSCRIPT'; item: TranscriptItem }
  | { type: 'AUDIO_LEVEL'; level: number; isDucking: boolean }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<UserSettings> }
  | { type: 'SETTINGS_UPDATED'; settings: UserSettings }
  | { type: 'TOGGLE_SUBTITLES'; enabled: boolean }
  | { type: 'OPEN_SIDEPANEL' }
  | { type: 'TEST_API_KEY'; apiKey: string }
  | { type: 'TEST_API_KEY_RESULT'; success: boolean; message: string };
