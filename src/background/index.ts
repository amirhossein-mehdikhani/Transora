import { DubbingState, ExtensionMessage, UserSettings, DEFAULT_SETTINGS } from '../types';
import { getStoredSettings, saveStoredSettings, appendStoredTranscript } from '../services/storage';

let currentState: DubbingState = {
  status: 'idle',
  audioLevel: 0,
  isDucking: false,
  stats: {
    latencyMs: 0,
    sentencesDubbed: 0,
    bytesProcessed: 0,
  },
};

let currentSettings: UserSettings = DEFAULT_SETTINGS;

// Initialize settings
getStoredSettings().then((settings) => {
  currentSettings = settings;
});

// Manage Offscreen Document for Tab Capture & Audio Processing
async function setupOffscreenDocument(path: string): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: path,
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
    ],
    justification: 'Real-time tab audio capture, ducking, and voice synthesis for live dubbing',
  });
}

async function closeOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

function updateBadge(status: DubbingState['status']) {
  if (status === 'dubbing' || status === 'listening') {
    chrome.action.setBadgeText({ text: 'LIVE' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366F1' });
  } else if (status === 'error') {
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function broadcastState(state: DubbingState) {
  currentState = state;
  updateBadge(state.status);

  // Send to all tabs and extension views
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state }).catch(() => {});

  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, { type: 'STATE_CHANGED', state }).catch(() => {});
  }
}

// Message Listener
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'GET_STATE': {
      return { state: currentState, settings: currentSettings };
    }

    case 'START_DUBBING': {
      try {
        const settings = await getStoredSettings();
        currentSettings = settings;

        if (!settings.googleApiKey) {
          broadcastState({
            ...currentState,
            status: 'error',
            errorMessage: 'Please enter your Google API Key in Settings to start dubbing.',
          });
          return { success: false, error: 'Missing API key' };
        }

        // Determine target tab
        let tabId = message.tabId || sender.tab?.id;
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = activeTab?.id;
        }

        if (!tabId) {
          throw new Error('No active tab found to dub.');
        }

        broadcastState({
          ...currentState,
          status: 'initializing',
          activeTabId: tabId,
          errorMessage: undefined,
        });

        // 1. Get media stream ID for tab audio capture
        const streamId = await new Promise<string>((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (!id) {
              reject(new Error('Failed to obtain stream ID'));
            } else {
              resolve(id);
            }
          });
        });

        // 2. Ensure Offscreen Document is running
        await setupOffscreenDocument('src/offscreen/index.html');

        // 3. Send streamId and settings to offscreen document
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_START_CAPTURE',
          streamId,
          settings: currentSettings,
          tabId,
        });

        broadcastState({
          ...currentState,
          status: 'dubbing',
          activeTabId: tabId,
        });

        return { success: true };
      } catch (err: any) {
        console.error('Failed to start dubbing:', err);
        broadcastState({
          ...currentState,
          status: 'error',
          errorMessage: err.message || 'Failed to start tab audio capture',
        });
        return { success: false, error: err.message };
      }
    }

    case 'STOP_DUBBING': {
      try {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' }).catch(() => {});
        await closeOffscreenDocument();

        broadcastState({
          status: 'idle',
          activeTabId: undefined,
          audioLevel: 0,
          isDucking: false,
          stats: currentState.stats,
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    case 'UPDATE_SETTINGS': {
      const updated = await saveStoredSettings(message.settings);
      currentSettings = updated;
      
      // Notify offscreen document if running
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: updated }).catch(() => {});

      return { success: true, settings: updated };
    }

    case 'AUDIO_LEVEL': {
      currentState.audioLevel = message.level;
      currentState.isDucking = message.isDucking;
      // Pass along to active content script
      if (currentState.activeTabId) {
        chrome.tabs.sendMessage(currentState.activeTabId, message).catch(() => {});
      }
      return { success: true };
    }

    case 'NEW_TRANSCRIPT': {
      currentState.stats.sentencesDubbed += 1;
      currentState.currentOriginalText = message.item.originalText;
      currentState.currentTranslatedText = message.item.translatedText;

      await appendStoredTranscript(message.item);

      // Forward to content script for subtitle rendering
      if (currentState.activeTabId) {
        chrome.tabs.sendMessage(currentState.activeTabId, message).catch(() => {});
      }

      return { success: true };
    }

    case 'OPEN_SIDEPANEL': {
      let tabId = sender.tab?.id;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }
      if (tabId && (chrome as any).sidePanel?.open) {
        (chrome as any).sidePanel.open({ tabId }).catch(() => {});
      }
      return { success: true };
    }

    default:
      return null;
  }
}
