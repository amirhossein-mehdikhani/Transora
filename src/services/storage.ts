import { type UserSettings, DEFAULT_SETTINGS, type TranscriptItem, SUPPORTED_LANGUAGES } from '../types';
const SETTINGS = 'transora_user_settings';
const TRANSCRIPTS = 'transora_transcript_history';
let settingsWrite = Promise.resolve();
let transcriptWrite = Promise.resolve();
export function validateSettings(input: Partial<UserSettings>): UserSettings {
  const value = { ...DEFAULT_SETTINGS, ...input };
  const clamp = (n: number, low: number, high: number, fallback: number) => Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
  return {
    ...DEFAULT_SETTINGS,
    engine: value.engine === 'http' ? 'http' : 'gemini_live',
    liveModel: typeof value.liveModel === 'string' && /^[a-zA-Z0-9._-]+$/.test(value.liveModel) ? value.liveModel : DEFAULT_SETTINGS.liveModel,
    googleApiKey: typeof value.googleApiKey === 'string' ? value.googleApiKey.trim() : '',
    geminiModel: typeof value.geminiModel === 'string' && /^[a-zA-Z0-9./_-]+$/.test(value.geminiModel) ? value.geminiModel.replace(/^models\//, '') : DEFAULT_SETTINGS.geminiModel,
    targetLanguage: SUPPORTED_LANGUAGES.some(lang => lang.code === value.targetLanguage) ? value.targetLanguage : 'fa',
    sourceLanguage: value.sourceLanguage === 'auto' || SUPPORTED_LANGUAGES.some(lang => lang.code === value.sourceLanguage) ? value.sourceLanguage : 'auto',
    voiceGender: ['FEMALE', 'MALE', 'NEUTRAL'].includes(value.voiceGender) ? value.voiceGender : 'FEMALE',
    voiceSpeed: clamp(value.voiceSpeed, 0.8, 1.5, 1),
    duckingLevel: clamp(value.duckingLevel, 0, 1, 0.18),
    audioBufferSizeMs: clamp(value.audioBufferSizeMs, 1000, 8000, 2500),
    mode: value.mode === 'meeting' ? 'meeting' : 'video',
    subtitlesEnabled: typeof value.subtitlesEnabled === 'boolean' ? value.subtitlesEnabled : true,
    bilingualSubtitles: typeof value.bilingualSubtitles === 'boolean' ? value.bilingualSubtitles : true,
  };
}
export async function getStoredSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(SETTINGS);
  return validateSettings(result[SETTINGS] || {});
}
export function saveStoredSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const result = settingsWrite.then(async () => {
    const settings = validateSettings({ ...await getStoredSettings(), ...patch });
    await chrome.storage.local.set({ [SETTINGS]: settings });
    return settings;
  });
  settingsWrite = result.then(() => {}, () => {});
  return result;
}
export async function getStoredTranscripts(): Promise<TranscriptItem[]> {
  const result = await chrome.storage.local.get(TRANSCRIPTS);
  return Array.isArray(result[TRANSCRIPTS]) ? result[TRANSCRIPTS] : [];
}
export function appendStoredTranscript(item: TranscriptItem): Promise<void> {
  const result = transcriptWrite.then(async () => {
    const items = await getStoredTranscripts();
    await chrome.storage.local.set({ [TRANSCRIPTS]: [item, ...items.filter(entry => entry.id !== item.id)].slice(0, 150) });
  });
  transcriptWrite = result.catch(() => {});
  return result;
}
export function clearStoredTranscripts(): Promise<void> {
  const result = transcriptWrite.then(() => chrome.storage.local.remove(TRANSCRIPTS));
  transcriptWrite = result.catch(() => {});
  return result;
}

/**
 * Validates Google Gemini / Cloud API Key by testing the Gemini models endpoint
 */
export async function testGoogleApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { success: false, message: 'API Key cannot be empty.' };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`;
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const msg = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, message: `Google API Error: ${msg}` };
    }

    const data = await response.json();
    if (data.models && Array.isArray(data.models)) {
      return { 
        success: true, 
        message: `Key verified successfully! Found ${data.models.length} accessible models.` 
      };
    }

    return { success: true, message: 'Google API key validated successfully!' };
  } catch (err: any) {
    return { success: false, message: `Network/CORS error: ${err.message || 'Failed to connect to Google API'}` };
  }
}

/**
 * Dynamically queries Google AI Studio API for all available models associated with the user's API key
 */
export async function fetchLiveGeminiModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  if (!apiKey || apiKey.trim().length === 0) return [];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`;
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];

    const data = await response.json();
    if (!data.models || !Array.isArray(data.models)) return [];

    return data.models
      .filter((m: any) => m.supportedGenerationMethods?.some((method: string) => ['generateContent', 'bidiGenerateContent'].includes(method)))
      .map((m: any) => ({
        id: m.name.replace(/^models\//, ''),
        name: m.displayName || m.name.replace(/^models\//, ''),
      }));
  } catch (e) {
    console.error('Failed to fetch live Gemini models:', e);
    return [];
  }
}

