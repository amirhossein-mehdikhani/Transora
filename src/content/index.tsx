import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIslandHUD } from './components/DynamicIslandHUD';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import { DubbingState, UserSettings, DEFAULT_SETTINGS, SupportedLanguage, TranscriptItem } from '../types';
import { 
  translateTextWithGemini, 
  translateAudioWithGemini, 
  synthesizeSpeechGoogleCloud,
  synthesizeSpeechGeminiAudio,
  playAudioBuffer,
  transliteratePersianToPhonetic 
} from '../services/google-gemini-live';
import contentStyles from './styles/content.css?inline';

// Global references for in-page dubbing
let ytCaptionObserver: MutationObserver | null = null;
let localMediaRecorder: MediaRecorder | null = null;
let localSliceInterval: any = null;
let activeVideoEl: HTMLVideoElement | null = null;
let originalVideoVolume = 1.0;
let isSpeakingDub = false;
let audioContextInstance: AudioContext | null = null;

function stopAllDubbing() {
  if (ytCaptionObserver) {
    ytCaptionObserver.disconnect();
    ytCaptionObserver = null;
    const style = document.getElementById('transora-yt-caption-override');
    if (style) style.remove();
  }
  if (localSliceInterval) {
    clearInterval(localSliceInterval);
    localSliceInterval = null;
  }
  if (localMediaRecorder) {
    try {
      if (localMediaRecorder.state !== 'inactive') localMediaRecorder.stop();
    } catch (_) {}
    localMediaRecorder = null;
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

// Reliable speech audio playback across all platforms (Tier 1: Gemini Audio -> Tier 2: Cloud TTS -> Tier 3: Browser Speech)
async function playDubbedAudio(
  text: string,
  targetLang: SupportedLanguage,
  apiKey: string,
  speed = 1.0,
  gender: 'FEMALE' | 'MALE' | 'NEUTRAL' = 'FEMALE',
  model = 'gemini-flash-lite-latest',
  onStart?: () => void,
  onEnd?: () => void
) {
  isSpeakingDub = true;
  onStart?.();

  if (!audioContextInstance) {
    audioContextInstance = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioContextInstance.state === 'suspended') {
    await audioContextInstance.resume();
  }

  // Tier 1: Try Gemini Flash Lite TTS Studio Audio (Free AI Studio Key, works for Persian & all languages!)
  if (apiKey && apiKey.trim().length > 0) {
    try {
      const pcmBuffer = await synthesizeSpeechGeminiAudio(text, targetLang, apiKey, gender, 'gemini-3.8-flash-lite-tts');
      await playAudioBuffer(audioContextInstance, pcmBuffer);
      isSpeakingDub = false;
      onEnd?.();
      return;
    } catch (geminiAudioErr) {
      console.log('Gemini native audio fallback:', geminiAudioErr);
    }

    // Tier 2: Try Google Cloud TTS (For GCP billing keys)
    try {
      const cloudBuffer = await synthesizeSpeechGoogleCloud(text, targetLang, apiKey, gender, speed);
      await playAudioBuffer(audioContextInstance, cloudBuffer);
      isSpeakingDub = false;
      onEnd?.();
      return;
    } catch (cloudErr) {
      console.log('Cloud TTS fallback:', cloudErr);
    }
  }

  // Tier 3: Browser Speech Synthesis with Linux & Multi-platform Voice Matching
  if (!('speechSynthesis' in window)) {
    isSpeakingDub = false;
    onEnd?.();
    return;
  }

  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      await new Promise<void>((r) => setTimeout(r, 100));
      voices = window.speechSynthesis.getVoices();
    }

    // Check if system has a native voice for the target language
    const langMatch = voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.toLowerCase()));
    
    let textToSpeak = text;
    let chosenVoice: SpeechSynthesisVoice | null = null;
    let chosenLang = targetLang as string;

    if (langMatch) {
      chosenVoice = langMatch;
      chosenLang = langMatch.lang;
    } else {
      // If no native voice for target language (e.g. Persian on Linux):
      const fallbackVoice = voices.find((v) => v.default) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
      if (fallbackVoice) {
        chosenVoice = fallbackVoice;
        chosenLang = fallbackVoice.lang;
        // Transliterate Persian to phonetic Latin characters so English eSpeak actually pronounces it aloud!
        if (targetLang === 'fa') {
          textToSpeak = transliteratePersianToPhonetic(text);
        }
      }
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = speed || 1.0;
    if (chosenVoice) {
      utterance.voice = chosenVoice;
      utterance.lang = chosenLang;
    }

    utterance.onend = () => {
      isSpeakingDub = false;
      onEnd?.();
    };

    utterance.onerror = () => {
      isSpeakingDub = false;
      onEnd?.();
    };

    window.speechSynthesis.speak(utterance);

    // Watchdog timer to ensure ducking is restored even if speech synthesis hangs
    setTimeout(() => {
      if (isSpeakingDub) {
        isSpeakingDub = false;
        onEnd?.();
      }
    }, 6000);

  } catch (err) {
    console.warn('Speech synthesis error:', err);
    isSpeakingDub = false;
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

  // Scoped Tailwind styles inside Shadow DOM
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

    // 1. Direct fetch from chrome.storage.local for 100% reliable settings load
    React.useEffect(() => {
      chrome.storage.local.get(['transora_user_settings'], (result) => {
        if (result?.transora_user_settings) {
          setSettings((prev) => ({ ...prev, ...result.transora_user_settings }));
        }
      });

      const storageListener = (changes: any, area: string) => {
        if (area === 'local' && changes.transora_user_settings) {
          setSettings((prev) => ({ ...prev, ...changes.transora_user_settings.newValue }));
        }
      };
      chrome.storage.onChanged.addListener(storageListener);

      // Background message listener
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
          // Offscreen document tab audio capture requested voice synthesis
          playDubbedAudio(
            msg.text,
            msg.lang || settings.targetLanguage,
            settings.googleApiKey,
            msg.speed || settings.voiceSpeed,
            settings.voiceGender,
            settings.geminiModel || 'gemini-flash-lite-latest',
            () => {
              setState((prev) => ({ ...prev, isDucking: true, audioLevel: 85 }));
            },
            () => {
              setState((prev) => ({ ...prev, isDucking: false, audioLevel: 0 }));
              chrome.runtime.sendMessage({ type: 'FALLBACK_SPEECH_ENDED' }).catch(() => {});
            }
          );
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener);
        chrome.storage.onChanged.removeListener(storageListener);
      };
    }, []);

    // Translate sentence & speak dubbed audio
    const processSentence = async (sentence: string, video?: HTMLVideoElement) => {
      const cleanSentence = sentence.trim();
      if (!settings.googleApiKey || cleanSentence.length < 3) return;

      try {
        setState((prev) => ({
          ...prev,
          currentOriginalText: cleanSentence,
          audioLevel: 50,
        }));

        // Fast neural translation via Gemini Flash Lite
        const result = await translateTextWithGemini(
          cleanSentence,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.geminiModel || 'gemini-flash-lite-latest'
        );

        if (!result.translatedText || result.translatedText.trim().length === 0) return;

        const item: TranscriptItem = {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          originalText: cleanSentence,
          translatedText: result.translatedText,
          sourceLang: settings.sourceLanguage,
          targetLang: settings.targetLanguage,
        };

        setState((prev) => ({
          ...prev,
          currentOriginalText: cleanSentence,
          currentTranslatedText: result.translatedText,
          isDucking: true,
          audioLevel: 85,
        }));

        chrome.runtime.sendMessage({ type: 'NEW_TRANSCRIPT', item }).catch(() => {});

        // Duck video volume if active
        if (video) {
          activeVideoEl = video;
          originalVideoVolume = video.volume;
          video.volume = Math.max(0.04, originalVideoVolume * settings.duckingLevel);
        }

        // Play dubbed voice
        await playDubbedAudio(
          result.translatedText,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.voiceSpeed,
          settings.voiceGender,
          settings.geminiModel || 'gemini-flash-lite-latest',
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
        console.error('Translation & Dubbing error:', err);
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: `Gemini Error: ${err.message}`,
        }));
      }
    };

    const handleToggleDubbing = () => {
      // Toggle off if already active
      if (state.status === 'dubbing' || state.status === 'listening') {
        stopAllDubbing();
        chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
        setState((prev) => ({ ...prev, status: 'idle', isDucking: false, audioLevel: 0 }));
        return;
      }

      // Check API Key
      if (!settings.googleApiKey || settings.googleApiKey.trim().length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Google API Key required! Open Settings to enter your key.',
        }));
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
        return;
      }

      const video = document.querySelector('video') as HTMLVideoElement | null;
      let speechSourceStarted = false;

      // STRATEGY 1: YouTube Live Captions Streamer (Instant & Accurate on YouTube)
      const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (moviePlayer && video) {
        try {
          // Enable captions button if not on
          const subBtn = moviePlayer.querySelector('.ytp-subtitles-button') as HTMLElement;
          if (subBtn && subBtn.getAttribute('aria-pressed') !== 'true') {
            subBtn.click();
          }
          try {
            if (typeof (moviePlayer as any).toggleSubtitlesOn === 'function') {
              (moviePlayer as any).toggleSubtitlesOn();
            }
          } catch (_) {}

          // Hide YouTube native ugly caption box
          const overrideStyle = document.createElement('style');
          overrideStyle.id = 'transora-yt-caption-override';
          overrideStyle.textContent = `
            .ytp-caption-window-bottom, .caption-window {
              opacity: 0.01 !important;
              pointer-events: none !important;
            }
          `;
          document.head.appendChild(overrideStyle);

          let accumulatedSentence = '';
          let lastDispatchedSentence = '';
          let pauseTimer: any = null;
          let anyCaptionsDetected = false;

          const flushSentence = () => {
            const candidate = accumulatedSentence.trim();
            if (candidate.length > 2 && candidate !== lastDispatchedSentence) {
              lastDispatchedSentence = candidate;
              accumulatedSentence = '';
              processSentence(candidate, video);
            }
          };

          ytCaptionObserver = new MutationObserver(() => {
            const segments = moviePlayer.querySelectorAll('.ytp-caption-segment, .caption-visual-line, .captions-text');
            if (segments.length === 0) {
              // Flush any buffered sentence immediately if YouTube clears the window
              if (accumulatedSentence.trim().length > 2) {
                clearTimeout(pauseTimer);
                flushSentence();
              }
              return;
            }

            anyCaptionsDetected = true;
            let currentCaption = '';
            segments.forEach((s) => { currentCaption += (s.textContent || '') + ' '; });
            currentCaption = currentCaption.trim();

            if (currentCaption.length > 2 && currentCaption !== accumulatedSentence) {
              accumulatedSentence = currentCaption;
              clearTimeout(pauseTimer);

              // If phrase ends with punctuation or reached normal speaking cadence, flush in 350ms!
              const endsWithPunctuation = /[.!?؛،]$/.test(accumulatedSentence);
              const wordCount = accumulatedSentence.split(/\s+/).length;
              const delay = endsWithPunctuation || wordCount >= 7 ? 350 : 650;

              pauseTimer = setTimeout(flushSentence, delay);
            }
          });

          ytCaptionObserver.observe(moviePlayer, {
            childList: true,
            subtree: true,
            characterData: true,
          });

          // Watchdog timer: If after 3.5 seconds no captions are detected, alert user to press Alt+Shift+D
          setTimeout(() => {
            if (!anyCaptionsDetected && ytCaptionObserver) {
              setState((prev) => {
                if (prev.status === 'dubbing' && !prev.currentOriginalText) {
                  return {
                    ...prev,
                    errorMessage: 'Subtitles not detected on this video. Press Alt+Shift+D or click Transora icon in Chrome toolbar to capture audio directly!',
                  };
                }
                return prev;
              });
            }
          }, 3500);

          speechSourceStarted = true;
          setState((prev) => ({
            ...prev,
            status: 'dubbing',
            errorMessage: undefined,
          }));

        } catch (ytErr) {
          console.warn('YouTube caption hook failed:', ytErr);
        }
      }

      // STRATEGY 2: HTML5 Video Stream Capture (for non-YouTube HTML5 players)
      if (!speechSourceStarted && video && ((video as any).captureStream || (video as any).mozCaptureStream)) {
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

            let chunks: Blob[] = [];
            localMediaRecorder = new MediaRecorder(stream, { mimeType });

            localMediaRecorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) chunks.push(e.data);
            };

            localMediaRecorder.start(500);

            localSliceInterval = setInterval(() => {
              if (!localMediaRecorder || localMediaRecorder.state !== 'recording') return;
              localMediaRecorder.requestData();

              if (chunks.length > 0 && !video.paused && !video.muted) {
                const blob = new Blob(chunks, { type: mimeType });
                chunks = [];

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
                      settings.geminiModel || 'gemini-flash-lite-latest'
                    );

                    if (translation.speechDetected && translation.translatedText.trim()) {
                      processSentence(translation.originalText || '(Speech)', video);
                    }
                  } catch (e: any) {
                    console.warn('Audio stream translation:', e.message);
                  }
                };
                reader.readAsDataURL(blob);
              }
            }, 3000);

            speechSourceStarted = true;
            setState((prev) => ({ ...prev, status: 'dubbing', errorMessage: undefined }));
          }
        } catch (err) {
          console.warn('Direct stream capture error:', err);
        }
      }

      // STRATEGY 3: Tab Capture Engine via background service
      if (!speechSourceStarted) {
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
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
    };

    const handleTestDubbing = async () => {
      if (!settings.googleApiKey || settings.googleApiKey.trim().length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'Please enter your Google API Key in Settings to test audio.',
        }));
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
        return;
      }

      setState((prev) => ({
        ...prev,
        status: 'dubbing',
        currentOriginalText: 'Transora real-time AI dubbing audio test.',
        currentTranslatedText: settings.targetLanguage === 'fa' 
          ? 'دوبله زنده ترانسورا فعال و در حال تست صدا است.' 
          : 'Transora live dubbing audio test is running.',
        isDucking: true,
        audioLevel: 80,
      }));

      try {
        const testPhrase = 'Hello! Transora live AI video dubbing is working successfully.';
        const result = await translateTextWithGemini(
          testPhrase,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.geminiModel || 'gemini-flash-lite-latest'
        );

        setState((prev) => ({
          ...prev,
          currentOriginalText: testPhrase,
          currentTranslatedText: result.translatedText,
        }));

        await playDubbedAudio(
          result.translatedText,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.voiceSpeed,
          settings.voiceGender,
          settings.geminiModel || 'gemini-flash-lite-latest',
          () => setState((p) => ({ ...p, isDucking: true, audioLevel: 90 })),
          () => setState((p) => ({ ...p, isDucking: false, audioLevel: 0, status: 'idle' }))
        );
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: `Audio test failed: ${err.message}`,
          isDucking: false,
          audioLevel: 0,
        }));
      }
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
          onTestDubbing={handleTestDubbing}
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
