import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIslandHUD } from './components/DynamicIslandHUD';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import { DubbingState, UserSettings, DEFAULT_SETTINGS, SupportedLanguage, TranscriptItem } from '../types';
import { translateTextWithGemini, translateAudioWithGemini } from '../services/google-gemini-live';
import contentStyles from './styles/content.css?inline';

// Global hooks for in-page dubbing
let ytCaptionObserver: MutationObserver | null = null;
let localRecorder: MediaRecorder | null = null;
let localSliceTimer: any = null;
let activeVideoEl: HTMLVideoElement | null = null;
let originalVideoVolume = 1.0;
let isSpeakingDub = false;

function stopAllDubbing() {
  if (ytCaptionObserver) {
    ytCaptionObserver.disconnect();
    ytCaptionObserver = null;
    const style = document.getElementById('transora-yt-caption-override');
    if (style) style.remove();
  }
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
  isSpeakingDub = false;
}

// Speak translated text safely with browser speech synthesis
function speakTranslatedText(
  text: string,
  targetLang: SupportedLanguage,
  speed = 1.0,
  onStart?: () => void,
  onEnd?: () => void
) {
  if (!('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }

  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed || 1.0;

    // Pick best available voice
    const voices = window.speechSynthesis.getVoices();
    const langMatch = voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.toLowerCase()));
    if (langMatch) {
      utterance.voice = langMatch;
      utterance.lang = langMatch.lang;
    } else {
      // Fallback voice
      const genericVoice = voices.find((v) => v.name.includes('Google') || v.name.includes('Natural')) || voices[0];
      if (genericVoice) utterance.voice = genericVoice;
      utterance.lang = targetLang === 'fa' ? 'fa-IR' : targetLang;
    }

    utterance.onstart = () => {
      isSpeakingDub = true;
      onStart?.();
    };

    utterance.onend = () => {
      isSpeakingDub = false;
      onEnd?.();
    };

    utterance.onerror = (e) => {
      console.warn('Speech synthesis event:', e.error);
      isSpeakingDub = false;
      onEnd?.();
    };

    window.speechSynthesis.speak(utterance);

    // Watchdog timer to ensure ducking is restored if speech synthesis hangs
    setTimeout(() => {
      if (isSpeakingDub) {
        isSpeakingDub = false;
        onEnd?.();
      }
    }, 7000);

  } catch (err) {
    console.warn('Speech synthesis error:', err);
    onEnd?.();
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
          speakTranslatedText(
            msg.text,
            msg.lang,
            msg.speed,
            () => setState((prev) => ({ ...prev, isDucking: true, audioLevel: 80 })),
            () => {
              setState((prev) => ({ ...prev, isDucking: false, audioLevel: 0 }));
              chrome.runtime.sendMessage({ type: 'FALLBACK_SPEECH_ENDED' }).catch(() => {});
            }
          );
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, []);

    const handleSpeechSegment = async (originalSentence: string, video?: HTMLVideoElement) => {
      if (!settings.googleApiKey || originalSentence.trim().length < 3) return;

      try {
        setState((prev) => ({
          ...prev,
          currentOriginalText: originalSentence,
          audioLevel: 60,
        }));

        // Translate in real-time with Google Gemini Flash
        const result = await translateTextWithGemini(
          originalSentence,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.geminiModel || 'gemini-2.0-flash'
        );

        if (!result.translatedText) return;

        const item: TranscriptItem = {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          originalText: originalSentence,
          translatedText: result.translatedText,
          sourceLang: settings.sourceLanguage,
          targetLang: settings.targetLanguage,
        };

        setState((prev) => ({
          ...prev,
          currentOriginalText: originalSentence,
          currentTranslatedText: result.translatedText,
          isDucking: true,
          audioLevel: 85,
        }));

        chrome.runtime.sendMessage({ type: 'NEW_TRANSCRIPT', item }).catch(() => {});

        // Duck video volume if video element is active
        if (video) {
          activeVideoEl = video;
          originalVideoVolume = video.volume;
          video.volume = Math.max(0.04, originalVideoVolume * settings.duckingLevel);
        }

        // Speak the translated dub
        speakTranslatedText(
          result.translatedText,
          settings.targetLanguage,
          settings.voiceSpeed,
          () => {
            setState((prev) => ({ ...prev, isDucking: true, audioLevel: 80 }));
          },
          () => {
            if (video) {
              video.volume = originalVideoVolume;
            }
            setState((prev) => ({ ...prev, isDucking: false, audioLevel: 0 }));
          }
        );

      } catch (err: any) {
        console.warn('Real-time translation error:', err.message);
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: `Google API Error: ${err.message}`,
        }));
      }
    };

    const handleToggleDubbing = () => {
      // If currently active, stop
      if (state.status === 'dubbing' || state.status === 'listening') {
        stopAllDubbing();
        chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
        setState((prev) => ({ ...prev, status: 'idle', isDucking: false, audioLevel: 0 }));
        return;
      }

      // 1. Verify API Key is provided
      if (!settings.googleApiKey || settings.googleApiKey.trim().length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Google API Key required! Open Settings to add your key.',
        }));
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
        return;
      }

      const video = document.querySelector('video') as HTMLVideoElement | null;

      // 2. STRATEGY A: YouTube Live Captions Hook (Instant, Zero Latency, 100% Reliable on YouTube)
      const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (moviePlayer && video) {
        try {
          // Auto-enable closed captions if disabled
          const subBtn = moviePlayer.querySelector('.ytp-subtitles-button') as HTMLElement;
          if (subBtn && subBtn.getAttribute('aria-pressed') !== 'true') {
            subBtn.click();
          }

          // Hide YouTube's native black box caption so only Transora's bilingual subtitles render
          const style = document.createElement('style');
          style.id = 'transora-yt-caption-override';
          style.textContent = `
            .ytp-caption-window-bottom {
              opacity: 0.01 !important;
            }
          `;
          document.head.appendChild(style);

          let lastText = '';
          let debounceTimer: any = null;

          ytCaptionObserver = new MutationObserver(() => {
            const segments = moviePlayer.querySelectorAll('.ytp-caption-segment');
            if (segments.length === 0) return;

            let full = '';
            segments.forEach((s) => { full += (s.textContent || '') + ' '; });
            full = full.trim();

            if (full.length > 4 && full !== lastText) {
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                if (full !== lastText && full.length > 4) {
                  lastText = full;
                  handleSpeechSegment(full, video);
                }
              }, 600);
            }
          });

          ytCaptionObserver.observe(moviePlayer, {
            childList: true,
            subtree: true,
            characterData: true,
          });

          setState((prev) => ({
            ...prev,
            status: 'dubbing',
            errorMessage: undefined,
          }));

          return;

        } catch (ytErr) {
          console.warn('YouTube caption hook fallback:', ytErr);
        }
      }

      // 3. STRATEGY B: HTML5 Video Stream Capture
      if (video && ((video as any).captureStream || (video as any).mozCaptureStream)) {
        try {
          const stream = (video as any).captureStream 
            ? (video as any).captureStream() 
            : (video as any).mozCaptureStream();

          if (stream && stream.getAudioTracks().length > 0) {
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
                      handleSpeechSegment(translation.originalText || '(Speech)', video);
                    }
                  } catch (e: any) {
                    console.warn('Audio stream translation:', e.message);
                  }
                };
                reader.readAsDataURL(blob);
              }
            }, 2800);

            setState((prev) => ({ ...prev, status: 'dubbing', errorMessage: undefined }));
            return;
          }
        } catch (err) {
          console.warn('Video stream capture fallback:', err);
        }
      }

      // 4. STRATEGY C: Standard Background TabCapture
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
