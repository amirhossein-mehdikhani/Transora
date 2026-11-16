import { UserSettings, DEFAULT_SETTINGS, TranscriptItem } from '../types';

const STORAGE_KEYS = {
  SETTINGS: 'transora_user_settings',
  TRANSCRIPTS: 'transora_transcript_history',
} as const;

export async function getStoredSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      resolve(DEFAULT_SETTINGS);
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
      if (result[STORAGE_KEYS.SETTINGS]) {
        const loaded: UserSettings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
        // Auto-migrate deprecated or failing models to gemini-flash-lite-latest
        if (
          !loaded.geminiModel || 
          loaded.geminiModel.includes('gemini-2.0') || 
          loaded.geminiModel.includes('gemini-2.5-flash') ||
          loaded.geminiModel === 'gemini-3.8-flash'
        ) {
          loaded.geminiModel = 'gemini-flash-lite-latest';
          chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: loaded });
        }
        resolve(loaded);
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    });
  });
}

export async function saveStoredSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getStoredSettings();
  const updated = { ...current, ...settings };

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      resolve(updated);
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated }, () => {
      resolve(updated);
    });
  });
}

export async function getStoredTranscripts(): Promise<TranscriptItem[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      resolve([]);
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.TRANSCRIPTS], (result) => {
      resolve(result[STORAGE_KEYS.TRANSCRIPTS] || []);
    });
  });
}

export async function appendStoredTranscript(item: TranscriptItem): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  const current = await getStoredTranscripts();
  // Keep last 150 items to conserve memory
  const updated = [item, ...current].slice(0, 150);

  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.TRANSCRIPTS]: updated }, () => {
      resolve();
    });
  });
}

export async function clearStoredTranscripts(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.TRANSCRIPTS], () => {
      resolve();
    });
  });
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
    const response = await fetch(url, { method: 'GET' });

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
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return [];

    const data = await response.json();
    if (!data.models || !Array.isArray(data.models)) return [];

    return data.models
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => ({
        id: m.name.replace(/^models\//, ''),
        name: m.displayName || m.name.replace(/^models\//, ''),
      }));
  } catch (e) {
    console.error('Failed to fetch live Gemini models:', e);
    return [];
  }
}

