import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIslandHUD } from './components/DynamicIslandHUD';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import { DubbingState, UserSettings, DEFAULT_SETTINGS, SupportedLanguage } from '../types';
import contentStyles from './styles/content.css?inline';

function initTransoraContent() {
  const existingHost = document.getElementById('transora-host-container');
  if (existingHost) return;

  const host = document.createElement('div');
  host.id = 'transora-host-container';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647';
  document.documentElement.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Inject full compiled Tailwind CSS into isolated Shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = contentStyles;
  shadowRoot.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  mountPoint.id = 'transora-mount-point';
  shadowRoot.appendChild(mountPoint);

  const root = createRoot(mountPoint);

  const ContentApp: React.FC = () => {
    const [state, setState] = React.useState<DubbingState>({
      status: 'idle',
      audioLevel: 0,
      isDucking: false,
      stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
    });

    const [settings, setSettings] = React.useState<UserSettings>(DEFAULT_SETTINGS);

    // Initial fetch of state and settings
    React.useEffect(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        if (response?.state) setState(response.state);
        if (response?.settings) setSettings(response.settings);
      });

      const messageListener = (msg: any) => {
        if (msg.type === 'STATE_CHANGED') {
          setState(msg.state);
        } else if (msg.type === 'AUDIO_LEVEL') {
          setState((prev) => ({
            ...prev,
            audioLevel: msg.level,
            isDucking: msg.isDucking,
          }));
        } else if (msg.type === 'NEW_TRANSCRIPT') {
          setState((prev) => ({
            ...prev,
            currentOriginalText: msg.item.originalText,
            currentTranslatedText: msg.item.translatedText,
          }));
        } else if (msg.type === 'SETTINGS_UPDATED') {
          setSettings(msg.settings);
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, []);

    const handleToggleDubbing = () => {
      if (state.status === 'dubbing' || state.status === 'listening') {
        chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
      } else {
        chrome.runtime.sendMessage({ type: 'START_DUBBING' });
      }
    };

    const handleLanguageChange = (lang: SupportedLanguage) => {
      chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: { targetLanguage: lang },
      });
      setSettings((prev) => ({ ...prev, targetLanguage: lang }));
    };

    const handleToggleSubtitles = () => {
      const nextVal = !settings.subtitlesEnabled;
      chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: { subtitlesEnabled: nextVal },
      });
      setSettings((prev) => ({ ...prev, subtitlesEnabled: nextVal }));
    };

    const handleOpenSettings = () => {
      // Note: Open side panel
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
    };

    return (
      <>
        {/* Dynamic Island Floating HUD */}
        <DynamicIslandHUD
          state={state}
          settings={settings}
          onToggleDubbing={handleToggleDubbing}
          onLanguageChange={handleLanguageChange}
          onToggleSubtitles={handleToggleSubtitles}
          onOpenSettings={handleOpenSettings}
        />

        {/* Dynamic Dual-Language Subtitle Overlay */}
        <SubtitleOverlay
          originalText={state.currentOriginalText}
          translatedText={state.currentTranslatedText}
          targetLang={settings.targetLanguage}
          bilingual={settings.bilingualSubtitles}
          visible={settings.subtitlesEnabled}
        />
      </>
    );
  };

  root.render(<ContentApp />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTransoraContent);
} else {
  initTransoraContent();
}
