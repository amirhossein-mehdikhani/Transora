import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { DEFAULT_SETTINGS, LIVE_MODELS } = await import('../src/types/index.ts');
const { liveSetup, GeminiLiveSession } = await import('../src/services/gemini-live-session.ts');
let socket, processor;
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor(url) { this.url = url; socket = this; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
}
globalThis.WebSocket = FakeSocket;
globalThis.AudioWorkletNode = class {
  port = { close() {} };
  constructor() { processor = this; }
  connect() {} disconnect() {}
};
globalThis.chrome = { runtime: { getURL: path => path } };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(model = DEFAULT_SETTINGS.liveModel) {
  const updates = [], transcripts = [], errors = [], sources = [];
  const context = { currentTime: 0, destination: {}, audioWorklet: { async addModule() {} }, createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    createBuffer(_channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; },
    createBufferSource() { const source = { playbackRate: {}, connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } }; sources.push(source); return source; },
  };
  const session = new GeminiLiveSession(context, { connect() {}, disconnect() {} }, { ...DEFAULT_SETTINGS, liveModel: model, googleApiKey: 'test-key' }, 'session', {
    update: patch => updates.push(patch), transcript: item => transcripts.push(item), fail: error => errors.push(error), duck() {},
  });
  return { session, updates, transcripts, errors, sources };
}
async function open(session) {
  const ready = session.connect();
  socket.onopen();
  assert.equal(socket.sent.length, 1, 'only setup is sent until acknowledgment');
  socket.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
  await ready;
}
test('all six screenshot model families have Live configurations; specialized translation uses generationConfig', () => {
  assert.equal(LIVE_MODELS.length, 6);
  const translate = liveSetup(DEFAULT_SETTINGS).setup;
  assert.equal(translate.model, 'models/gemini-3.5-live-translate-preview');
  assert.equal(translate.generationConfig.translationConfig.targetLanguageCode, 'fa');
  assert.deepEqual(translate.generationConfig.responseModalities, ['AUDIO']);
  const transcribe = liveSetup({ ...DEFAULT_SETTINGS, liveModel: 'gemini-3.5-transcribe-live' }).setup;
  assert.deepEqual(transcribe.generationConfig.responseModalities, ['TEXT']);
  assert.equal(transcribe.outputAudioTranscription, undefined);
  const dialog = liveSetup({ ...DEFAULT_SETTINGS, liveModel: 'gemini-3.8-live' }).setup;
  assert.match(dialog.systemInstruction.parts[0].text, /Persian/);
  assert.equal(dialog.generationConfig.thinkingConfig, undefined);
});
test('Live audio waits for setup and sends PCM; every output part plays, transcript persists, stop cancels playback', async () => {
  const fixtureData = fixture();
  const { session, sources, transcripts } = fixtureData;
  await open(session);
  processor.port.onmessage({ data: new Int16Array([0, 100, -100]).buffer });
  assert.equal(socket.sent[1].realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  socket.onmessage({ data: JSON.stringify({ serverContent: { inputTranscription: { text: 'hello' }, outputTranscription: { text: 'salaam' }, modelTurn: { parts: [
    { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } },
    { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } },
  ] }, turnComplete: true } }) });
  await tick();
  assert.equal(sources.length, 2);
  assert.ok(sources[1].time >= sources[0].time);
  assert.equal(transcripts[0].translatedText, 'salaam');
  session.close();
  assert.ok(sources.every(source => source.stopped));
  assert.equal(socket.readyState, 3);
});
test('Transcribe Live emits source transcripts without pretending to translate', async () => {
  const { session, transcripts, sources } = fixture('gemini-3.5-transcribe-live');
  await open(session);
  socket.onmessage({ data: JSON.stringify({ serverContent: { inputTranscription: { text: 'original words' } } }) });
  await tick();
  assert.equal(transcripts[0].kind, 'transcription');
  assert.equal(transcripts[0].translatedText, '');
  assert.equal(sources.length, 0);
  session.close();
});
test('Live model access errors fail setup without an HTTP fallback', async () => {
  const { session } = fixture();
  const ready = session.connect();
  socket.onopen();
  socket.onmessage({ data: JSON.stringify({ error: { message: 'model not available' } }) });
  await assert.rejects(ready, /model not available/);
  assert.equal(socket.sent.length, 1);
});

test('continuous translation persists captions without waiting for a conversation turn', async () => {
  const { session, transcripts, updates } = fixture();
  await open(session);
  const phrase = 'This is a complete translated sentence with punctuation.';
  socket.onmessage({ data: JSON.stringify({ serverContent: { inputTranscription: { text: 'source sentence' }, outputTranscription: { text: phrase } } }) });
  await tick();
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].translatedText, phrase);
  assert.equal(socket.sent.length, 1, 'text segmentation never sends end-of-stream or a new model turn');
  assert.equal(liveSetup(DEFAULT_SETTINGS).setup.realtimeInputConfig.activityHandling, 'NO_INTERRUPTION');
  session.close();
});
