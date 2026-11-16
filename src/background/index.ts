import type { DubbingState, UserSettings } from '../types';
import { getStoredSettings, saveStoredSettings, appendStoredTranscript, clearStoredTranscripts } from '../services/storage';
import { idleState } from '../services/session';
let state = idleState();
let settings: UserSettings;
let sessionId: string | undefined;
let operation = Promise.resolve();
const ready = Promise.all([getStoredSettings(), chrome.storage.session.get('session')]).then(async ([saved, cached]) => {
  settings = saved;
  if (cached.session) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) ({ state, sessionId } = cached.session);
    else await chrome.storage.session.set({ session: { state, sessionId } });
  }
});
async function publish(next: DubbingState, persist = true) {
  const previousTab = state.activeTabId;
  const statusChanged = next.status !== state.status;
  state = next;
  if (persist) await chrome.storage.session.set({ session: { state, sessionId } });
  if (statusChanged) await chrome.action.setBadgeText({ text: state.status === 'error' ? 'ERR' : ['listening', 'dubbing'].includes(state.status) ? 'LIVE' : '' });
  if (statusChanged) void chrome.action.setBadgeBackgroundColor({ color: state.status === 'error' ? '#EF4444' : '#6366F1' });
  void chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state }).catch(() => {});
  for (const tabId of new Set([previousTab, state.activeTabId])) {
    if (tabId !== undefined) void chrome.tabs.sendMessage(tabId, { type: 'STATE_CHANGED', state }).catch(() => {});
  }
}
async function stop() {
  sessionId = undefined;
  if (state.activeTabId !== undefined) await chrome.tabs.sendMessage(state.activeTabId, { type: 'CANCEL_SPEECH' }).catch(() => {});
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' }).catch(() => {});
    await chrome.offscreen.closeDocument();
  }
  await publish({ ...idleState(), stats: state.stats });
}
async function start(tabId: number) {
  settings = await getStoredSettings();
  if (!settings.googleApiKey.trim()) throw new Error('Enter your Google API key in Settings first.');
  if (state.activeTabId === tabId && ['initializing', 'listening', 'dubbing'].includes(state.status)) return;
  await stop();
  sessionId = crypto.randomUUID();
  await publish({ ...idleState(), status: 'initializing', activeTabId: tabId });
  try {
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
        const error = chrome.runtime.lastError;
        if (error || !id) reject(new Error(error?.message || 'Click the Transora toolbar icon on this tab before starting capture.'));
        else resolve(id);
      });
    });
    await chrome.offscreen.createDocument({ url: 'src/offscreen/index.html', reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK], justification: 'Capture and dub tab audio while keeping original audio audible' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'START', streamId, settings, sessionId, tabId }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Audio capture timed out. Try starting again from the toolbar icon.')), 15000); }),
    ]).finally(() => clearTimeout(timer));
    if (!response?.success) throw new Error(response?.error || 'Audio capture did not start.');
    await publish({ ...state, status: 'listening' });
  } catch (error) { await stop(); throw error; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target === 'offscreen' || ['STATE_CHANGED', 'SETTINGS_UPDATED'].includes(message.type)) return;
  const task = async () => {
    await ready;
    if (message.type === 'GET_STATE') return { state, settings, ownsSession: sender.tab?.id === state.activeTabId && state.activeTabId !== undefined };
    if (message.type === 'OPEN_SIDEPANEL') {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
      return { success: true };
    }
    if (message.type === 'CLEAR_TRANSCRIPTS') {
      await clearStoredTranscripts();
      void chrome.runtime.sendMessage({ type: 'TRANSCRIPTS_CLEARED' }).catch(() => {});
      return { success: true };
    }
    if (message.type === 'UPDATE_SETTINGS') {
      const previous = settings;
      settings = await saveStoredSettings(message.settings);
      // Live connection configuration is fixed at setup: stop rather than silently using stale language/model/key.
      if (sessionId && (previous.engine !== settings.engine || (previous.engine === 'gemini_live' && ['liveModel', 'targetLanguage', 'sourceLanguage', 'googleApiKey', 'voiceGender', 'voiceSpeed'].some(key => previous[key as keyof UserSettings] !== settings[key as keyof UserSettings])))) {
        const result = operation.then(stop);
        operation = result.catch(() => {});
        await result;
      }
      void chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
      return { success: true, settings };
    }
    if (message.type === 'START_DUBBING' || message.type === 'STOP_DUBBING') {
      const action = async () => {
        if (message.type === 'STOP_DUBBING') await stop();
        else {
          const tabId = message.tabId ?? sender.tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
          if (tabId === undefined) throw new Error('Open a video tab first.');
          await start(tabId);
        }
      };
      const result = operation.then(action);
      operation = result.catch(() => {});
      await result;
      return { success: true };
    }
    if (sender.url !== chrome.runtime.getURL('src/offscreen/index.html') || !sessionId || message.sessionId !== sessionId) return;
    if (message.type === 'ENGINE_ERROR') {
      await stop();
      await publish({ ...state, status: 'error', errorMessage: message.error });
    } else if (message.type === 'ENGINE_ENDED') await stop();
    else if (message.type === 'ENGINE_UPDATE') await publish({ ...state, ...message.patch, stats: { ...state.stats, ...message.patch.stats } }, message.patch.audioLevel === undefined);
    else if (message.type === 'NEW_TRANSCRIPT') {
      await appendStoredTranscript(message.item);
      if (state.activeTabId !== undefined) void chrome.tabs.sendMessage(state.activeTabId, message).catch(() => {});
    } else if (message.type === 'PLAY_SPEECH_FALLBACK') {
      if (state.activeTabId === undefined) throw new Error('No active tab for speech playback.');
      return await chrome.tabs.sendMessage(state.activeTabId, message);
    } else if (message.type === 'GET_MEDIA_TIME') {
      return state.activeTabId === undefined ? null : await chrome.tabs.sendMessage(state.activeTabId, { type: 'GET_MEDIA_TIME' }).catch(() => null);
    }
    return { success: true };
  };
  void task().then(respond).catch(async error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (message.type === 'START_DUBBING') await publish({ ...state, status: 'error', errorMessage });
    respond({ success: false, error: errorMessage });
  });
  return true;
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-dubbing') return;
  operation = operation.then(async () => {
    await ready;
    if (['initializing', 'listening', 'dubbing'].includes(state.status)) await stop();
    else {
      const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (tabId === undefined) throw new Error('Open a video tab first.');
      await start(tabId);
    }
  }).catch(error => publish({ ...state, status: 'error', errorMessage: error.message }));
});
chrome.tabs.onRemoved.addListener(tabId => {
  void ready.then(() => { if (state.activeTabId === tabId) operation = operation.then(stop).catch(() => {}); });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void ready.then(() => { if (state.activeTabId === tabId) operation = operation.then(stop).catch(() => {}); });
});
