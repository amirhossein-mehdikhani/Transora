import { UserSettings, TranscriptItem } from '../types';
import { translateTextWithGemini, synthesizeSpeechGoogleCloud, synthesizeWithWebSpeech } from '../services/google-gemini-live';

let audioCtx: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let tabGainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;
let currentSettings: UserSettings | null = null;
let isDubbingActive = false;
let isAudioDucking = false;
let recognition: any = null;
let animationFrameId: number | null = null;

// Speech queue to prevent overlapping speech synthesis
const speechQueue: Array<{
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}> = [];
let isPlayingSpeech = false;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OFFSCREEN_START_CAPTURE') {
    startCapture(message.streamId, message.settings);
  } else if (message.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture();
  } else if (message.type === 'SETTINGS_UPDATED') {
    currentSettings = message.settings;
  }
});

async function startCapture(streamId: string, settings: UserSettings) {
  try {
    currentSettings = settings;
    isDubbingActive = true;

    // 1. Capture Tab Audio via streamId
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });

    // 2. Setup Web Audio Graph
    audioCtx = new AudioContext();
    const sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    // Tab Gain Node (for Ducking)
    tabGainNode = audioCtx.createGain();
    tabGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // Analyser Node (for dynamic audio wave HUD)
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    // Connect: Stream -> TabGain -> Speakers (so user hears original sound)
    sourceNode.connect(tabGainNode);
    tabGainNode.connect(audioCtx.destination);

    // Connect: Stream -> Analyser (for live meter)
    sourceNode.connect(analyserNode);

    // Start Audio Level Metering Loop
    startAudioMeter();

    // 3. Initialize Real-Time Speech Recognition
    startSpeechRecognition();

  } catch (err: any) {
    console.error('Error starting offscreen audio capture:', err);
    chrome.runtime.sendMessage({
      type: 'STATE_CHANGED',
      state: {
        status: 'error',
        errorMessage: err.message || 'Failed to capture tab audio',
        audioLevel: 0,
        isDucking: false,
        stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
      },
    });
  }
}

function startAudioMeter() {
  if (!analyserNode) return;
  const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

  let lastSentTime = 0;

  const checkLevel = (time: number) => {
    if (!isDubbingActive || !analyserNode) return;

    analyserNode.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    const normalizedLevel = Math.min(100, Math.round((avg / 255) * 100));

    // Send audio level to UI at ~15fps to avoid message spam
    if (time - lastSentTime > 66) {
      lastSentTime = time;
      chrome.runtime.sendMessage({
        type: 'AUDIO_LEVEL',
        level: normalizedLevel,
        isDucking: isAudioDucking,
      }).catch(() => {});
    }

    animationFrameId = requestAnimationFrame(checkLevel);
  };

  animationFrameId = requestAnimationFrame(checkLevel);
}

function startSpeechRecognition() {
  // Use WebKit Speech Recognition
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition API not available in this context');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.lang = currentSettings?.sourceLanguage === 'auto' ? 'en-US' : currentSettings?.sourceLanguage || 'en-US';

  recognition.onresult = async (event: any) => {
    const results = event.results;
    const lastResult = results[results.length - 1];

    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript.trim();
      if (transcript.length > 2) {
        processSpokenSegment(transcript);
      }
    }
  };

  recognition.onerror = (event: any) => {
    console.warn('Speech recognition event:', event.error);
    // Restart recognition if it timed out or paused
    if (isDubbingActive && event.error !== 'aborted') {
      try {
        recognition.stop();
      } catch (_) {}
      setTimeout(() => {
        if (isDubbingActive) {
          try { recognition.start(); } catch (_) {}
        }
      }, 500);
    }
  };

  recognition.onend = () => {
    if (isDubbingActive) {
      try { recognition.start(); } catch (_) {}
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.warn('Failed to start recognition immediately:', err);
  }
}

async function processSpokenSegment(text: string) {
  if (!currentSettings || !currentSettings.googleApiKey) return;

  try {
    const targetLang = currentSettings.targetLanguage;
    const apiKey = currentSettings.googleApiKey;
    const model = currentSettings.geminiModel || 'gemini-1.5-flash';

    // 1. Fast Neural Translation via Gemini Flash
    const translation = await translateTextWithGemini(text, targetLang, apiKey, model);

    const transcriptItem: TranscriptItem = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      originalText: text,
      translatedText: translation.translatedText,
      sourceLang: currentSettings.sourceLanguage,
      targetLang: currentSettings.targetLanguage,
    };

    // Broadcast new transcript for subtitles and transcript list
    chrome.runtime.sendMessage({
      type: 'NEW_TRANSCRIPT',
      item: transcriptItem,
    }).catch(() => {});

    // 2. Queue for Dubbed Speech Synthesis
    speechQueue.push({
      originalText: text,
      translatedText: translation.translatedText,
      sourceLang: currentSettings.sourceLanguage,
      targetLang: currentSettings.targetLanguage,
    });

    processSpeechQueue();

  } catch (err) {
    console.error('Failed to translate and dub segment:', err);
  }
}

async function processSpeechQueue() {
  if (isPlayingSpeech || speechQueue.length === 0 || !audioCtx) return;

  isPlayingSpeech = true;
  const currentItem = speechQueue.shift()!;
  const settings = currentSettings!;

  try {
    // Apply Audio Ducking: Drop original video audio smoothly
    setAudioDucking(true, settings.duckingLevel);

    // Try Google Cloud TTS first with User's BYOK API Key
    try {
      const audioBuffer = await synthesizeSpeechGoogleCloud(
        currentItem.translatedText,
        settings.targetLanguage,
        settings.googleApiKey,
        settings.voiceGender,
        settings.voiceSpeed
      );

      // Decode audio and play via Web Audio API
      const decodedAudio = await audioCtx.decodeAudioData(audioBuffer);
      const dubSource = audioCtx.createBufferSource();
      dubSource.buffer = decodedAudio;
      dubSource.connect(audioCtx.destination);

      await new Promise<void>((resolve) => {
        dubSource.onended = () => resolve();
        dubSource.start();
      });

    } catch (ttsErr) {
      console.warn('Google Cloud TTS unavailable or failed, falling back to Web Speech API:', ttsErr);
      // Fallback: Local Web Speech Synthesis
      await synthesizeWithWebSpeech(
        currentItem.translatedText,
        settings.targetLanguage,
        settings.voiceSpeed
      );
    }

  } catch (err) {
    console.error('Error during dubbed voice playback:', err);
  } finally {
    // Release Audio Ducking smoothly
    setAudioDucking(false, 1.0);
    isPlayingSpeech = false;

    // Continue queue
    if (speechQueue.length > 0) {
      setTimeout(() => processSpeechQueue(), 150);
    }
  }
}

function setAudioDucking(duck: boolean, targetLevel: number) {
  if (!tabGainNode || !audioCtx) return;
  isAudioDucking = duck;

  const now = audioCtx.currentTime;
  const timeConstant = duck ? 0.08 : 0.25; // Duck fast (80ms), release gently (250ms)
  tabGainNode.gain.setTargetAtTime(targetLevel, now, timeConstant);
}

function stopCapture() {
  isDubbingActive = false;
  isAudioDucking = false;
  isPlayingSpeech = false;
  speechQueue.length = 0;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (recognition) {
    try {
      recognition.onend = null;
      recognition.stop();
    } catch (_) {}
    recognition = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  tabGainNode = null;
  analyserNode = null;
}

