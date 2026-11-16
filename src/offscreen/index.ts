import { GeminiLiveSession } from '../services/gemini-live-session';
import type { UserSettings, TranscriptItem } from '../types';
import { chunkDuration } from '../services/session';
import { translateAudioWithGemini } from '../services/google-gemini-live';
import { speakCloud } from '../services/speech';
let live: GeminiLiveSession | undefined;
let settings: UserSettings;
let sessionId: string | undefined;
let controller = new AbortController();
let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let recorder: MediaRecorder | undefined;
let meter: ReturnType<typeof setInterval> | undefined;
let slice: ReturnType<typeof setTimeout> | undefined;
let peak = 0;
let ducking = false;
let startedAt = 0;
let bytesProcessed = 0;
let sentencesDubbed = 0;
let pending = 0;
let browserSpeaking = false;
let suppressSegment = false;
let pipeline = Promise.resolve();
const send = (type: string, data = {}) => chrome.runtime.sendMessage({ type, sessionId, ...data });
function stop() {
  sessionId = undefined;
  live?.close();
  live = undefined;
  controller.abort();
  clearInterval(meter);
  clearTimeout(slice);
  if (recorder?.state === 'recording') recorder.stop();
  recorder = undefined;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  void context?.close();
  context = undefined;
  gain = undefined;
  ducking = false;
  browserSpeaking = false;
  suppressSegment = false;
  peak = 0;
  pending = 0;
  pipeline = Promise.resolve();
}
function duck(active: boolean) {
  if (ducking === active) return;
  ducking = active;
  if (gain && context) gain.gain.setTargetAtTime(active ? settings.duckingLevel : 1, context.currentTime, active ? 0.08 : 0.28);
}
async function processChunk(blob: Blob, startMs: number, endMs: number, id: string, snapshot: UserSettings, signal: AbortSignal) {
  if (signal.aborted || sessionId !== id) return;
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const result = await translateAudioWithGemini(base64, blob.type, snapshot.targetLanguage, snapshot.googleApiKey, snapshot.geminiModel, signal, snapshot.sourceLanguage);
    if (signal.aborted || sessionId !== id) return;
    bytesProcessed += blob.size;
    await send('ENGINE_UPDATE', { patch: { stats: { bytesProcessed, latencyMs: result.latencyMs } } });
    if (!result.speechDetected) return;
    const item: TranscriptItem = { id: crypto.randomUUID(), sessionId: id, timestamp: Date.now(), startMs, endMs, originalText: result.originalText, translatedText: result.translatedText, sourceLang: snapshot.sourceLanguage, targetLang: snapshot.targetLanguage };
    // Subtitles follow speech playback rather than racing ahead of queued audio.
    await send('NEW_TRANSCRIPT', { item });
    await send('ENGINE_UPDATE', { patch: { status: 'dubbing', currentOriginalText: item.originalText, currentTranslatedText: item.translatedText } });
    const ctx = context;
    if (!ctx) return;
    try {
      await speakCloud(ctx, item.translatedText, snapshot, signal, () => duck(true));
    } catch (error) {
      if (signal.aborted) return;
      duck(true);
      browserSpeaking = true;
      suppressSegment = true;
      try {
        const response = await send('PLAY_SPEECH_FALLBACK', { text: item.translatedText, lang: snapshot.targetLanguage, speed: snapshot.voiceSpeed });
        if (!response?.success) throw new Error(response?.error || 'No speech voice is available for this language.');
      } finally { browserSpeaking = false; }
    } finally { if (sessionId === id) duck(false); }
    if (signal.aborted || sessionId !== id) return;
    sentencesDubbed++;
    await send('ENGINE_UPDATE', { patch: { status: 'listening', stats: { sentencesDubbed } } });
  } catch (error) {
    if (!signal.aborted && sessionId === id) void send('ENGINE_ERROR', { error: error instanceof Error ? error.message : String(error) });
  }
}
function recordSegment(id: string) {
  if (!stream || sessionId !== id) return;
  const snapshot = { ...settings };
  const signal = controller.signal;
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser cannot record WebM audio.');
  const current = new MediaRecorder(stream, { mimeType });
  recorder = current;
  const chunks: Blob[] = [];
  let startMs = performance.now() - startedAt;
  // Prefer the player's timeline; meeting tabs use elapsed session time.
  void send('GET_MEDIA_TIME').then(result => { if (Number.isFinite(result?.timeMs)) startMs = result.timeMs; }).catch(() => {});
  const recordedAt = performance.now();
  peak = 0;
  suppressSegment = browserSpeaking;
  current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  current.onerror = () => { void send('ENGINE_ERROR', { error: 'Audio recording failed.' }); };
  current.onstop = () => {
    if (sessionId !== id || signal.aborted) return;
    const endMs = startMs + performance.now() - recordedAt;
    const audible = peak > 2 && !suppressSegment;
    // Every upload is a completed recording, including its own WebM header.
    try { recordSegment(id); } catch (error) { void send('ENGINE_ERROR', { error: error instanceof Error ? error.message : String(error) }); return; }
    if (!audible || !chunks.length) return;
    if (pending >= 4) {
      void send('ENGINE_ERROR', { error: 'Translation cannot keep up with playback. Increase the audio segment duration or select a faster model.' });
      return;
    }
    pending++;
    const blob = new Blob(chunks, { type: mimeType });
    pipeline = pipeline.then(() => processChunk(blob, startMs, endMs, id, snapshot, signal)).finally(() => { if (sessionId === id) pending--; });
  };
  current.start();
  slice = setTimeout(() => { if (current.state === 'recording') current.stop(); }, chunkDuration(snapshot));
}
async function start(message: { sessionId: string; streamId: string; settings: UserSettings }) {
  stop();
  sessionId = message.sessionId;
  const id = sessionId;
  controller = new AbortController();
  settings = message.settings;
  const captured = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } as MediaTrackConstraints, video: false });
  if (sessionId !== id) { captured.getTracks().forEach(track => track.stop()); throw new Error('Capture cancelled.'); }
  stream = captured;
  context = new AudioContext();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  gain = context.createGain();
  source.connect(gain);
  gain.connect(context.destination);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const values = new Uint8Array(analyser.frequencyBinCount);
  bytesProcessed = sentencesDubbed = 0;
  startedAt = performance.now();
  // Preserve the timer-based meter from b604981: hidden documents suspend animation frames.
  meter = setInterval(() => {
    analyser.getByteFrequencyData(values);
    const level = Math.min(100, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 255 * 100));
    peak = Math.max(peak, level);
    void send('ENGINE_UPDATE', { patch: { audioLevel: level, isDucking: ducking } }).catch(() => {});
  }, 150);
  stream.getTracks().forEach(track => track.onended = () => { if (sessionId === id) void send('ENGINE_ENDED'); });
  if (settings.engine === 'gemini_live') {
    live = new GeminiLiveSession(context, source, { ...settings }, id, {
      update: patch => { if (sessionId === id) void send('ENGINE_UPDATE', { patch }).catch(() => {}); },
      transcript: item => { if (sessionId === id) void send('NEW_TRANSCRIPT', { item }).catch(() => {}); },
      fail: error => { if (sessionId === id) void send('ENGINE_ERROR', { error }).catch(() => {}); },
      duck,
    });
    await live.connect();
  } else recordSegment(id);
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'SETTINGS_UPDATED') { settings = message.settings; return; }
  if (message.target !== 'offscreen') return;
  if (message.type === 'STOP') { stop(); respond({ success: true }); return; }
  if (message.type === 'START') {
    void start(message).then(() => respond({ success: true })).catch(error => { stop(); respond({ success: false, error: error.message }); });
    return true;
  }
});
