import { SupportedLanguage } from '../types';

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  latencyMs: number;
}

const LANGUAGE_NAME_MAP: Record<SupportedLanguage, string> = {
  fa: 'Persian (Farsi)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  zh: 'Simplified Chinese',
  ar: 'Arabic',
  tr: 'Turkish',
  ru: 'Russian',
  hi: 'Hindi',
  it: 'Italian',
};

/**
 * Real-Time Multimodal Audio Translation via Google Gemini API
 * Accepts captured audio directly from video tab and performs transcription + translation in 1 step!
 */
export async function translateAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  targetLang: SupportedLanguage,
  apiKey: string,
  model = 'gemini-2.0-flash'
): Promise<{ speechDetected: boolean; originalText: string; translatedText: string; latencyMs: number }> {
  const startTime = performance.now();
  const targetLangName = LANGUAGE_NAME_MAP[targetLang] || targetLang;

  const prompt = `Listen carefully to this audio segment recorded from a video.
Task:
1. Detect if any human speech is present.
2. If speech is present, transcribe the exact spoken words into English (or original language) and translate them into natural, conversational, fluent ${targetLangName}.
3. If only silence, noise, sound effects, or background music is present without spoken words, mark speechDetected as false.

Return JSON in this format:
{
  "speechDetected": true,
  "original": "transcribed speech in source language",
  "translated": "natural spoken translation in ${targetLangName}"
}

If no speech:
{
  "speechDetected": false,
  "original": "",
  "translated": ""
}`;

  const cleanModel = model.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey.trim()}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType.split(';')[0], // e.g. audio/webm
              data: audioBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      maxOutputTokens: 300,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const latencyMs = Math.round(performance.now() - startTime);

  try {
    const parsed = JSON.parse(rawText);
    return {
      speechDetected: Boolean(parsed.speechDetected && parsed.translated?.trim().length > 0),
      originalText: parsed.original || '',
      translatedText: parsed.translated || '',
      latencyMs,
    };
  } catch (e) {
    return {
      speechDetected: false,
      originalText: '',
      translatedText: '',
      latencyMs,
    };
  }
}

/**
 * Real-Time Translation via Google Gemini API (Text-based)
 */
export async function translateTextWithGemini(
  text: string,
  targetLang: SupportedLanguage,
  apiKey: string,
  model = 'gemini-1.5-flash'
): Promise<TranslationResult> {
  const startTime = performance.now();
  const targetLangName = LANGUAGE_NAME_MAP[targetLang] || targetLang;

  const prompt = `You are a high-speed real-time professional video dubbing translator.
Translate the following transcribed spoken audio segment into natural, conversational, fluent ${targetLangName}.
Requirements:
1. Preserve the tone, emotion, and pace of the speaker.
2. Adapt idioms and colloquial speech naturally for spoken dialogue.
3. Output ONLY the translated text without explanations, brackets, or notes.

Text to translate:
"${text}"`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 250,
      topP: 0.8,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawTranslation = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleanTranslation = rawTranslation.trim().replace(/^["']|["']$/g, '');

  const latencyMs = Math.round(performance.now() - startTime);

  return {
    originalText: text,
    translatedText: cleanTranslation,
    latencyMs,
  };
}

/**
 * Text-to-Speech via Google Cloud TTS API
 */
export async function synthesizeSpeechGoogleCloud(
  text: string,
  targetLang: SupportedLanguage,
  apiKey: string,
  gender: 'FEMALE' | 'MALE' | 'NEUTRAL' = 'FEMALE',
  speed = 1.0
): Promise<ArrayBuffer> {
  const langCodeMap: Record<SupportedLanguage, string> = {
    fa: 'fa-IR',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    ja: 'ja-JP',
    zh: 'cmn-CN',
    ar: 'ar-XA',
    tr: 'tr-TR',
    ru: 'ru-RU',
    hi: 'hi-IN',
    it: 'it-IT',
  };

  const languageCode = langCodeMap[targetLang] || 'en-US';

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey.trim()}`;

  const payload = {
    input: { text },
    voice: {
      languageCode,
      ssmlGender: gender,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speed,
      pitch: 0,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error?.message || `Google Cloud TTS error ${response.status}`);
  }

  const result = await response.json();
  if (!result.audioContent) {
    throw new Error('TTS response did not contain audioContent.');
  }

  // Base64 to ArrayBuffer
  const binaryString = atob(result.audioContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Fallback Web Speech API Speech Synthesis for zero-latency or non-cloud fallback
 */
export function synthesizeWithWebSpeech(
  text: string,
  lang: string,
  speed = 1.0
): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = speed;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
}

