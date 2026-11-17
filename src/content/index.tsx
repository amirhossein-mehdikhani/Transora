import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIslandHUD } from './components/DynamicIslandHUD';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import { DEFAULT_SETTINGS, type UserSettings } from '../types';
import { idleState, captionWindow } from '../services/session';
import { speakBrowser } from '../services/speech';
import contentStyles from './styles/content.css?inline';
let speech: AbortController | undefined;
function ContentApp() {
  const [state, setState] = useState(idleState);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    let mounted = true;
    const listener = (message: any, _sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
      if (message.type === 'STATE_CHANGED') {
        setState(message.state);
        if (['idle', 'error'].includes(message.state.status)) { speech?.abort(); setOwned(false); }
        else setOwned(true);
      } else if (message.type === 'SETTINGS_UPDATED') setSettings(message.settings);
      else if (message.type === 'NEW_TRANSCRIPT' && message.item.kind !== 'translation') setState(previous => ({ ...previous, currentOriginalText: captionWindow(message.item.originalText, 80), currentTranslatedText: message.item.kind === 'transcription' ? captionWindow(message.item.originalText, 80) : captionWindow(message.item.translatedText, 120) }));
      else if (message.type === 'GET_MEDIA_TIME') {
        const video = document.querySelector('video');
        respond({ timeMs: video && Number.isFinite(video.currentTime) ? video.currentTime * 1000 : undefined });
      } else if (message.type === 'CANCEL_SPEECH') { speech?.abort(); respond({ success: true }); }
      else if (message.type === 'PLAY_SPEECH_FALLBACK') {
        speech?.abort();
        speech = new AbortController();
        void speakBrowser(message.text, message.lang, message.speed, speech.signal)
          .then(() => respond({ success: true })).catch(error => respond({ success: false, error: error.message }));
        return true;
      }
    };
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.transora_user_settings?.newValue) setSettings(changes.transora_user_settings.newValue);
    };
    chrome.storage.onChanged.addListener(storageListener);
    chrome.runtime.onMessage.addListener(listener);
    void chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(response => {
      if (!mounted) return;
      if (response?.settings) setSettings(response.settings);
      if (response?.ownsSession) { setState(response.state); setOwned(true); }
    }).catch(() => {});
    return () => { mounted = false; speech?.abort(); chrome.storage.onChanged.removeListener(storageListener); chrome.runtime.onMessage.removeListener(listener); };
  }, []);
  const update = (patch: Partial<UserSettings>) => { void chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }); };
  return <>
    {settings.hudVisible && <DynamicIslandHUD state={state} settings={settings}
      onToggleDubbing={() => {
        void chrome.runtime.sendMessage({ type: owned && ['initializing', 'dubbing', 'listening'].includes(state.status) ? 'STOP_DUBBING' : 'START_DUBBING' })
          .then(response => { if (response?.success === false) setState(previous => ({ ...previous, status: 'error', errorMessage: response.error })); })
          .catch(error => setState(previous => ({ ...previous, status: 'error', errorMessage: error.message })));
      }}
      onLanguageChange={targetLanguage => update({ targetLanguage })}
      onToggleSubtitles={() => update({ subtitlesEnabled: !settings.subtitlesEnabled })}
      onHide={() => update({ hudVisible: false })}
      onOpenSettings={() => { void chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }); }} />}
    <SubtitleOverlay originalText={state.currentOriginalText} translatedText={state.currentTranslatedText} targetLang={settings.targetLanguage}
      bilingual={settings.bilingualSubtitles} visible={owned && settings.subtitlesEnabled && ['listening', 'dubbing'].includes(state.status)} />
  </>;
}
if (!document.getElementById('transora-host-container')) {
  const host = document.createElement('div');
  host.id = 'transora-host-container';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  document.documentElement.appendChild(host);
  document.addEventListener('fullscreenchange', () => {
    const fullscreen = document.fullscreenElement;
    // Player containers can render overlays; a native fullscreen video element cannot.
    const parent = fullscreen && !(fullscreen instanceof HTMLVideoElement) ? fullscreen : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = contentStyles;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);
  createRoot(mount).render(<ContentApp />);
}
