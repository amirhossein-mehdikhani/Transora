import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
let listener, command;
let hasOffscreen = false;
let captureCount = 0;
let failCapture = false;
const routed = [];
const local = { transora_user_settings: { googleApiKey: 'test-key' } };
let snapshot = {};
globalThis.chrome = {
  storage: { local: { async get(key) { return { [key]: local[key] }; }, async set(value) { Object.assign(local, value); } }, session: { async get() { return {}; }, async set(value) { snapshot = structuredClone(value); } } },
  runtime: { id: 'extension', getURL: path => 'chrome-extension://extension/' + path,
    onMessage: { addListener(fn) { listener = fn; } },
    async getContexts() { return hasOffscreen ? [{}] : []; },
    async sendMessage(message) {
      if (message.type === 'START') return failCapture ? { success: false, error: 'permission denied' } : { success: true };
      return { success: true };
    },
  },
  tabCapture: { getMediaStreamId(_options, callback) { captureCount++; callback('stream'); } },
  offscreen: { Reason: { USER_MEDIA: 'USER_MEDIA', AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' }, async createDocument() { hasOffscreen = true; }, async closeDocument() { hasOffscreen = false; } },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  tabs: { async query() { return [{ id: 7 }]; }, async sendMessage(tabId, message) { routed.push({ tabId, message }); return { success: true }; }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  commands: { onCommand: { addListener(fn) { command = fn; } } },
};
chrome.runtime.ContextType = { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' };
await import('../src/background/index.ts');
const sender = { id: 'extension', url: chrome.runtime.getURL('src/popup/index.html') };
const request = (message, from = sender) => new Promise(resolve => listener(message, from, resolve));

test('session startup acknowledgments, duplicate starts, fallback routing, stop and stale messages', async () => {
  failCapture = true;
  const failed = await request({ type: 'START_DUBBING', tabId: 7 });
  assert.equal(failed.success, false);
  assert.equal((await request({ type: 'GET_STATE' })).state.status, 'error');
  assert.equal(hasOffscreen, false);
  failCapture = false;
  await Promise.all([request({ type: 'START_DUBBING', tabId: 7 }), request({ type: 'START_DUBBING', tabId: 7 })]);
  assert.equal(captureCount, 2, 'one failed capture and one successful capture; duplicate start is ignored');
  assert.equal((await request({ type: 'GET_STATE' })).state.status, 'listening');
  const id = snapshot.session.sessionId;
  const offscreen = { id: 'extension', url: chrome.runtime.getURL('src/offscreen/index.html') };
  const playback = await request({ type: 'PLAY_SPEECH_FALLBACK', sessionId: id, text: 'hello' }, offscreen);
  assert.equal(playback.success, true);
  assert.ok(routed.some(entry => entry.tabId === 7 && entry.message.type === 'PLAY_SPEECH_FALLBACK'));
  await request({ type: 'STOP_DUBBING' });
  await request({ type: 'ENGINE_UPDATE', sessionId: id, patch: { status: 'dubbing' } }, offscreen);
  assert.equal((await request({ type: 'GET_STATE' })).state.status, 'idle');
  assert.equal(hasOffscreen, false);
  assert.ok(routed.some(entry => entry.message.type === 'CANCEL_SPEECH'));
});
test('shortcut invokes session lifecycle directly rather than sending a message to itself', async () => {
  command('toggle-dubbing', { id: 7 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await request({ type: 'GET_STATE' })).state.status, 'listening');
  command('toggle-dubbing', { id: 7 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await request({ type: 'GET_STATE' })).state.status, 'idle');
});
