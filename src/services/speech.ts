import type { UserSettings } from '../types';
import { synthesizeSpeechGeminiAudio, synthesizeSpeechGoogleCloud, playAudioBuffer, translateTextWithGemini } from './google-gemini-live';
export async function speakCloud(context: AudioContext, text: string, settings: UserSettings, signal?: AbortSignal, onStart?: () => void) {
  try {
    const buffer = await synthesizeSpeechGeminiAudio(text, settings.targetLanguage, settings.googleApiKey, settings.voiceGender, 'gemini-3.1-flash-tts-preview', signal);
    signal?.throwIfAborted();
    await playAudioBuffer(context, buffer, signal, settings.voiceSpeed, onStart);
  } catch (error) {
    if (signal?.aborted) throw error;
    const buffer = await synthesizeSpeechGoogleCloud(text, settings.targetLanguage, settings.googleApiKey, settings.voiceGender, settings.voiceSpeed, signal);
    signal?.throwIfAborted();
    await playAudioBuffer(context, buffer, signal, 1, onStart);
  }
}

export function speakBrowser(text: string, lang: string, speed: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('Browser speech is unavailable.'));
    let utterance: SpeechSynthesisUtterance;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', begin);
      signal?.removeEventListener('abort', cancel);
      if (utterance) { utterance.onend = null; utterance.onerror = null; }
      error ? reject(error) : resolve();
    };
    const cancel = () => { finish(new Error('Speech cancelled.')); speechSynthesis.cancel(); };
    const begin = () => {
      const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
      if (!voice) return;
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', begin);
      utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = speed;
      utterance.onend = () => finish();
      utterance.onerror = event => finish(new Error(`Speech playback failed: ${event.error}`));
      timer = setTimeout(cancel, Math.max(30000, text.length * 250 / speed));
      speechSynthesis.speak(utterance);
    };
    if (signal?.aborted) return reject(new Error('Speech cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error(`No browser voice installed for ${lang}.`)), 2000);
    speechSynthesis.addEventListener('voiceschanged', begin);
    begin();
  });
}
export async function testVoice(settings: UserSettings) {
  if (settings.engine === 'gemini_live') throw new Error('Start dubbing on a playing tab to test the selected Live model. Sample voice tests use the HTTP engine only.');
  const context = new AudioContext();
  try {
    const result = await translateTextWithGemini('Hello! Transora voice output is working.', settings.targetLanguage, settings.googleApiKey, settings.geminiModel);
    try { await speakCloud(context, result.translatedText, settings); }
    catch { await speakBrowser(result.translatedText, settings.targetLanguage, settings.voiceSpeed); }
  } finally { await context.close(); }
}
