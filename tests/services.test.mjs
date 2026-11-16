import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { exportSrt, chunkDuration } = await import('../src/services/session.ts');
const { validateSettings, saveStoredSettings, appendStoredTranscript, getStoredTranscripts } = await import('../src/services/storage.ts');
const api = await import('../src/services/google-gemini-live.ts');
const { DEFAULT_SETTINGS } = await import('../src/types/index.ts');
const store = {};
globalThis.chrome = { storage: { local: {
  async get(key) { return { [key]: structuredClone(store[key]) }; },
  async set(value) { await new Promise(resolve => setTimeout(resolve, 2)); Object.assign(store, structuredClone(value)); },
  async remove(key) { delete store[key]; },
}}};

test('SRT uses media position, preserves hours, sorts records and excludes untimed history', () => {
  const result = exportSrt([
    { timestamp: 3, startMs: 3601234, endMs: 3602500, translatedText: 'second', originalText: 'original' },
    { timestamp: 1, translatedText: 'legacy' },
    { timestamp: 2, startMs: 2000, endMs: 2900, translatedText: 'first', originalText: 'one' },
  ], true);
  assert.match(result, /^1\n00:00:02,000 --> 00:00:02,900\nfirst\none/);
  assert.match(result, /01:00:01,234 --> 01:00:02,500/);
  assert.doesNotMatch(result, /legacy/);
});
test('meeting mode caps duration and malformed settings cannot break the audio graph', () => {
  assert.equal(chunkDuration({ mode: 'meeting', audioBufferSizeMs: 8000 }), 1500);
  assert.equal(chunkDuration({ mode: 'video', audioBufferSizeMs: 8000 }), 8000);
  const settings = validateSettings({ voiceSpeed: NaN, duckingLevel: -10, audioBufferSizeMs: Infinity, targetLanguage: 'invalid', geminiModel: 'models/custom-model' });
  assert.equal(settings.voiceSpeed, 1);
  assert.equal(settings.duckingLevel, 0);
  assert.equal(settings.targetLanguage, 'fa');
  assert.equal(settings.geminiModel, 'custom-model');
});
test('concurrent settings writes and transcript appends preserve both changes', async () => {
  await Promise.all([saveStoredSettings({ targetLanguage: 'de' }), saveStoredSettings({ voiceSpeed: 1.3 })]);
  assert.equal(store.transora_user_settings.targetLanguage, 'de');
  assert.equal(store.transora_user_settings.voiceSpeed, 1.3);
  await Promise.all([appendStoredTranscript({ id: 'one' }), appendStoredTranscript({ id: 'two' })]);
  assert.equal((await getStoredTranscripts()).length, 2);
});
test('translation sends source language, abort signal and audio; rejects malformed JSON', async () => {
  let request;
  globalThis.fetch = async (url, options) => { request = options; return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ speechDetected: true, original: 'hello', translated: 'hallo' }) }] } }] }); };
  const result = await api.translateAudioWithGemini('AA==', 'audio/webm;codecs=opus', 'de', 'key', 'custom', undefined, 'en');
  assert.equal(result.translatedText, 'hallo');
  const payload = JSON.parse(request.body);
  assert.equal(payload.contents[0].parts[0].inlineData.mimeType, 'audio/webm');
  assert.match(payload.contents[0].parts[1].text, /Source language: en/);
  assert.ok(request.signal instanceof AbortSignal);
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
  await assert.rejects(api.translateAudioWithGemini('AA==', 'audio/webm', 'de', 'key'), /invalid JSON/);
});
test('quota failures do not silently switch models', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'quota exhausted' } }, { status: 429 }); };
  await assert.rejects(api.translateAudioWithGemini('AA==', 'audio/webm', 'de', 'key', 'custom'), /quota/);
  assert.equal(calls, 1);
});
test('Gemini PCM is wrapped in a WAV container using the returned sample rate', async () => {
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: 'AAAAAA==', mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] });
  const wav = await api.synthesizeSpeechGeminiAudio('hello', 'en', 'key');
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(wav).getUint32(24, true), 24000);
  assert.equal(wav.byteLength, 48);
});
test('aborting playback stops its source and rejects the pending operation', async () => {
  let stopped = false;
  const source = { connect() {}, disconnect() {}, start() {}, stop() { stopped = true; }, playbackRate: {} };
  const context = { state: 'running', decodeAudioData: async () => ({}), createBufferSource: () => source, destination: {} };
  const controller = new AbortController();
  const playing = api.playAudioBuffer(context, new ArrayBuffer(4), controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(playing, /Cancelled/);
  assert.equal(stopped, true);
});

test('rolling captions stay readable while retaining the newest words', async () => {
  const { captionWindow } = await import('../src/services/session.ts');
  assert.equal(captionWindow('short phrase'), 'short phrase');
  const output = captionWindow('old sentence '.repeat(40) + 'latest translated words');
  assert.ok(output.length <= 181);
  assert.ok(output.startsWith('…'));
  assert.ok(output.endsWith('latest translated words'));
});
