import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
let listener, meter;
const events = [];
const requests = [];
const recorders = [];
const originalInterval = globalThis.setInterval;
globalThis.setInterval = fn => { meter = fn; return originalInterval(() => {}, 100000); };
globalThis.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { events.push(message); return message.type === 'GET_MEDIA_TIME' ? { timeMs: 10000 } : { success: true }; } } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() {} }] }; } } } });
globalThis.AudioContext = class {
  currentTime = 0;
  destination = {};
  async resume() {}
  async close() {}
  createMediaStreamSource() { return { connect() {} }; }
  createGain() { return { connect() {}, gain: { setTargetAtTime() {} } }; }
  createAnalyser() { return { frequencyBinCount: 32, getByteFrequencyData(values) { values.fill(80); } }; }
};
globalThis.MediaRecorder = class {
  static isTypeSupported() { return true; }
  state = 'inactive';
  constructor() { this.number = recorders.length; recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable({ data: new Blob(['WEBM_HEADER_' + this.number]) });
    this.onstop();
  }
};
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = 'data:audio/webm;base64,' + Buffer.from(buffer).toString('base64'); this.onload(); }); }
};
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ speechDetected: false, original: '', translated: '' }) }] } }] });
};
const { DEFAULT_SETTINGS } = await import('../src/types/index.ts');
await import('../src/offscreen/index.ts');
const request = message => new Promise(resolve => listener(message, {}, resolve));
test('each segment completes a fresh recording and stop prevents late uploads', async () => {
  const started = await request({ target: 'offscreen', type: 'START', sessionId: 'one', streamId: 'stream', settings: { ...DEFAULT_SETTINGS, engine: 'http', googleApiKey: 'key' } });
  assert.equal(started.success, true);
  meter(); recorders[0].stop();
  await new Promise(resolve => setTimeout(resolve, 10));
  meter(); recorders[1].stop();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests.length, 2);
  assert.equal(Buffer.from(requests[0].contents[0].parts[0].inlineData.data, 'base64').toString(), 'WEBM_HEADER_0');
  assert.equal(Buffer.from(requests[1].contents[0].parts[0].inlineData.data, 'base64').toString(), 'WEBM_HEADER_1');
  const stopped = await request({ target: 'offscreen', type: 'STOP' });
  assert.equal(stopped.success, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(requests.length, 2);
  assert.ok(events.some(message => message.type === 'ENGINE_UPDATE' && message.patch.stats?.bytesProcessed > 0));
});
