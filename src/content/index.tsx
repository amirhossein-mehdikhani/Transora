import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIslandHUD } from './components/DynamicIslandHUD';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import { DubbingState, UserSettings, DEFAULT_SETTINGS, SupportedLanguage, TranscriptItem } from '../types';
import { translateAudioWithGemini } from '../services/google-gemini-live';
import contentStyles from './styles/content.css?inline';

let localRecorder: MediaRecorder | null = null;
let localSliceTimer: any = null;
let activeVideoEl: HTMLVideoElement | null = null;
let originalVideoVolume = 1.0;

function stopLocalVideoDubbing() {
  if (localSliceTimer) {
    clearInterval(localSliceTimer);
    localSliceTimer = null;
  }
  if (localRecorder) {
    try {
      if (localRecorder.state !== 'inactive') localRecorder.stop();
    } catch (_) {}
    localRecorder = null;
  }
  if (activeVideoEl) {
    activeVideoEl.volume = originalVideoVolume;
    activeVideoEl = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

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
        } else if (msg.type === 'PLAY_SPEECH_FALLBACK') {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(msg.text);
            utterance.lang = msg.lang === 'fa' ? 'fa-IR' : (msg.lang || 'en-US');
            utterance.rate = msg.speed || 1.0;
            utterance.onend = () => {
              chrome.runtime.sendMessage({ type: 'FALLBACK_SPEECH_ENDED' }).catch(() => {});
            };
            utterance.onerror = () => {
              chrome.runtime.sendMessage({ type: 'FALLBACK_SPEECH_ENDED' }).catch(() => {});
            };
            window.speechSynthesis.speak(utterance);
          } else {
            chrome.runtime.sendMessage({ type: 'FALLBACK_SPEECH_ENDED' }).catch(() => {});
          }
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, []);

    const handleToggleDubbing = () => {
      if (state.status === 'dubbing' || state.status === 'listening') {
        stopLocalVideoDubbing();
        chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
        setState((prev) => ({ ...prev, status: 'idle', isDucking: false, audioLevel: 0 }));
        return;
      }

      // Check if page has an active HTML5 video element (YouTube, Twitch, Coursera, etc.)
      const video = document.querySelector('video') as HTMLVideoElement | null;
      const canCaptureVideo = Boolean(video && ((video as any).captureStream || (video as any).mozCaptureStream));

      if (canCaptureVideo && video) {
        try {
          const stream = (video as any).captureStream 
            ? (video as any).captureStream() 
            : (video as any).mozCaptureStream();

          if (stream && stream.getAudioTracks().length > 0) {
            // Start in-page video dubbing
            activeVideoEl = video;
            originalVideoVolume = video.volume;

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : 'audio/webm';

            let currentChunks: Blob[] = [];
            localRecorder = new MediaRecorder(stream, { mimeType });

            localRecorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) currentChunks.push(e.data);
            };

            localRecorder.start(500);

            localSliceTimer = setInterval(() => {
              if (!localRecorder || localRecorder.state !== 'recording') return;
              localRecorder.requestData();

              if (currentChunks.length > 0 && !video.paused && !video.muted && video.volume > 0.05) {
                const blob = new Blob(currentChunks, { type: mimeType });
                currentChunks = [];

                const reader = new FileReader();
                reader.onloadend = async () => {
                  const base64Audio = (reader.result as string).split(',')[1];
                  if (!base64Audio || !settings.googleApiKey) return;

                  try {
                    const translation = await translateAudioWithGemini(
                      base64Audio,
                      mimeType,
                      settings.targetLanguage,
                      settings.googleApiKey,
                      settings.geminiModel || 'gemini-2.0-flash'
                    );

                    if (translation.speechDetected && translation.translatedText.trim()) {
                      const item: TranscriptItem = {
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: Date.now(),
                        originalText: translation.originalText || '(Video speech)',
                        translatedText: translation.translatedText,
                        sourceLang: settings.sourceLanguage,
                        targetLang: settings.targetLanguage,
                      };

                      setState((prev) => ({
                        ...prev,
                        currentOriginalText: item.originalText,
                        currentTranslatedText: item.translatedText,
                        isDucking: true,
                        audioLevel: 75,
                      }));

                      chrome.runtime.sendMessage({ type: 'NEW_TRANSCRIPT', item }).catch(() => {});

                      // Duck video volume directly
                      video.volume = Math.max(0.04, originalVideoVolume * settings.duckingLevel);

                      if ('speechSynthesis' in window) {
                        window.speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(translation.translatedText);
                        utterance.lang = settings.targetLanguage === 'fa' ? 'fa-IR' : settings.targetLanguage;
                        utterance.rate = settings.voiceSpeed || 1.0;
                        utterance.onend = () => {
                          video.volume = originalVideoVolume;
                          setState((prev) => ({ ...prev, isDucking: false, audioLevel: 0 }));
                        };
                        utterance.onerror = () => {
                          video.volume = originalVideoVolume;
                          setState((prev) => ({ ...prev, isDucking: false, audioLevel: 0 }));
                        };
                        window.speechSynthesis.speak(utterance);
                      }
                    }
                  } catch (e: any) {
                    console.warn('In-page translation:', e.message);
                  }
                };
                reader.readAsDataURL(blob);
              }
            }, 2800);

            setState((prev) => ({ ...prev, status: 'dubbing', errorMessage: undefined }));
            return;
          }
        } catch (err) {
          console.warn('Direct video capture fallback to tabCapture:', err);
        }
      }

      // Fallback: Use standard background tabCapture
      chrome.runtime.sendMessage({ type: 'START_DUBBING' });
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
