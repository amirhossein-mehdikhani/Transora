import { UserSettings, TranscriptItem } from '../types';
import { 
  translateAudioWithGemini, 
  synthesizeSpeechGoogleCloud,
  synthesizeSpeechGeminiAudio,
  playAudioBuffer 
} from '../services/google-gemini-live';

let audioCtx: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let tabGainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;
let currentSettings: UserSettings | null = null;
let isDubbingActive = false;
let isAudioDucking = false;
let audioMeterInterval: any = null;
let mediaRecorder: MediaRecorder | null = null;
let activeTabId: number | null = null;

// Audio processing & VAD variables
let currentAudioLevel = 0;
let peakLevelInCurrentChunk = 0;
let isProcessingChunk = false;

// Queue of translated sentences awaiting voice synthesis
const speechQueue: Array<{
  originalText: string;
  translatedText: string;
  targetLang: string;
}> = [];
let isPlayingVoice = false;

// Listen for messages from background script or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START_CAPTURE') {
    activeTabId = message.tabId || null;
    startCapture(message.streamId, message.settings);
    sendResponse({ received: true });
    return true;
  } else if (message.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture();
    sendResponse({ received: true });
    return true;
  } else if (message.type === 'SETTINGS_UPDATED') {
    currentSettings = message.settings;
    sendResponse({ received: true });
    return true;
  } else if (message.type === 'FALLBACK_SPEECH_ENDED') {
    // Content script finished playing local fallback speech
    onSpeechPlaybackDone();
    sendResponse({ received: true });
    return true;
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
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    // Tab Gain Node (controls Volume Ducking)
    tabGainNode = audioCtx.createGain();
    tabGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // Analyser Node (for dynamic audio wave HUD & Voice Activity Detection)
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    // Connect: Stream -> TabGain -> Output (so the user continues hearing original sound)
    sourceNode.connect(tabGainNode);
    tabGainNode.connect(audioCtx.destination);

    // Connect: Stream -> Analyser (for live meter)
    sourceNode.connect(analyserNode);

    // Start Audio Level Metering Loop & VAD
    startAudioMeter();

    // 3. Initialize Audio Stream Chunk Recorder
    startStreamRecorder();

  } catch (err: any) {
    console.error('Error starting tab audio capture:', err);
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

  if (audioMeterInterval) {
    clearInterval(audioMeterInterval);
  }

  // Use setInterval because Chromium suspends requestAnimationFrame in offscreen/hidden contexts!
  audioMeterInterval = setInterval(() => {
    if (!isDubbingActive || !analyserNode) {
      if (audioMeterInterval) clearInterval(audioMeterInterval);
      return;
    }

    analyserNode.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    currentAudioLevel = Math.min(100, Math.round((avg / 255) * 100));

    // Track peak volume in current slice to determine if speech/sound occurred
    if (currentAudioLevel > peakLevelInCurrentChunk) {
      peakLevelInCurrentChunk = currentAudioLevel;
    }

    // Broadcast audio level to UI at ~15fps
    chrome.runtime.sendMessage({
      type: 'AUDIO_LEVEL',
      level: currentAudioLevel,
      isDucking: isAudioDucking,
    }).catch(() => {});
  }, 66);
}

function startStreamRecorder() {
  if (!mediaStream) return;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  let currentChunks: Blob[] = [];

  try {
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        currentChunks.push(e.data);
      }
    };

    // Slice audio every 2.8 seconds for continuous streaming translation
    const CHUNK_INTERVAL_MS = 2800;

    const sliceTimer = setInterval(() => {
      if (!isDubbingActive || !mediaRecorder) {
        clearInterval(sliceTimer);
        return;
      }

      if (mediaRecorder.state === 'recording') {
        mediaRecorder.requestData();

        const peak = peakLevelInCurrentChunk;
        peakLevelInCurrentChunk = 0; // Reset peak tracker for next slice

        // Check if there was actual audible sound in this segment (above silence threshold of 2%)
        if (peak > 2 && currentChunks.length > 0 && !isProcessingChunk) {
          const combinedBlob = new Blob(currentChunks, { type: mimeType });
          currentChunks = [];
          handleAudioChunk(combinedBlob, mimeType);
        } else {
          // Keep chunk buffer compact
          if (currentChunks.length > 3) {
            currentChunks = currentChunks.slice(-2);
          }
        }
      }
    }, CHUNK_INTERVAL_MS);

    mediaRecorder.start(500); // deliver data in 500ms intervals

  } catch (err) {
    console.error('Failed to start MediaRecorder:', err);
  }
}

async function handleAudioChunk(blob: Blob, mimeType: string) {
  if (!currentSettings || !currentSettings.googleApiKey || isProcessingChunk) return;

  isProcessingChunk = true;

  try {
    // Convert Blob to Base64
    const base64Audio = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.substring(result.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // 1. Direct Multimodal Audio Translation with Google Gemini API
    const translation = await translateAudioWithGemini(
      base64Audio,
      mimeType,
      currentSettings.targetLanguage,
      currentSettings.googleApiKey,
      currentSettings.geminiModel || 'gemini-flash-lite-latest'
    );

    if (translation.speechDetected && translation.translatedText.trim().length > 0) {
      const transcriptItem: TranscriptItem = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now(),
        originalText: translation.originalText || '(Audio speech)',
        translatedText: translation.translatedText,
        sourceLang: currentSettings.sourceLanguage,
        targetLang: currentSettings.targetLanguage,
      };

      // Broadcast new transcript for live subtitles & transcript history
      chrome.runtime.sendMessage({
        type: 'NEW_TRANSCRIPT',
        item: transcriptItem,
      }).catch(() => {});

      // Queue for dubbed speech synthesis
      speechQueue.push({
        originalText: translation.originalText,
        translatedText: translation.translatedText,
        targetLang: currentSettings.targetLanguage,
      });

      processSpeechQueue();
    }

  } catch (err: any) {
    console.error('Failed to translate audio chunk:', err);
    // If invalid key or quota error, notify UI
    if (err.message && (err.message.includes('API key') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('403'))) {
      chrome.runtime.sendMessage({
        type: 'STATE_CHANGED',
        state: {
          status: 'error',
          errorMessage: err.message,
          audioLevel: 0,
          isDucking: false,
          stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
        },
      });
    }
  } finally {
    isProcessingChunk = false;
  }
}

async function processSpeechQueue() {
  if (isPlayingVoice || speechQueue.length === 0 || !audioCtx) return;

  isPlayingVoice = true;
  const currentItem = speechQueue.shift()!;
  const settings = currentSettings!;

  try {
    // Apply Audio Ducking: Drop original video sound
    setAudioDucking(true, settings.duckingLevel);

    // Tier 1: Try Gemini Flash Native Audio (Free AI Studio Key!)
    let playedVoice = false;
    try {
      const pcmBuffer = await synthesizeSpeechGeminiAudio(
        currentItem.translatedText,
        settings.targetLanguage as any,
        settings.googleApiKey,
        settings.voiceGender,
        'gemini-3.8-flash-lite-tts'
      );
      await playAudioBuffer(audioCtx, pcmBuffer);
      playedVoice = true;
      onSpeechPlaybackDone();
      return;
    } catch (geminiAudioErr) {
      // Continue to next tier
    }

    // Tier 2: Try Google Cloud TTS (For GCP Keys with Cloud TTS enabled)
    try {
      const audioBuffer = await synthesizeSpeechGoogleCloud(
        currentItem.translatedText,
        settings.targetLanguage as any,
        settings.googleApiKey,
        settings.voiceGender,
        settings.voiceSpeed
      );
      await playAudioBuffer(audioCtx, audioBuffer);
      playedVoice = true;
      onSpeechPlaybackDone();
      return;
    } catch (ttsErr) {
      // Cloud TTS is not enabled on standard AI Studio free keys;
      playedVoice = false;
    }

    // Tier 3: Delegate to browser SpeechSynthesis in the active tab
    if (!playedVoice && activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'PLAY_SPEECH_FALLBACK',
        text: currentItem.translatedText,
        lang: settings.targetLanguage,
        speed: settings.voiceSpeed,
      }).catch(() => {
        setTimeout(() => onSpeechPlaybackDone(), 2500);
      });
    } else if (!playedVoice) {
      setTimeout(() => onSpeechPlaybackDone(), 1500);
    }

  } catch (err) {
    console.error('Error during voice synthesis:', err);
    onSpeechPlaybackDone();
  }
}

function onSpeechPlaybackDone() {
  // Release Audio Ducking smoothly
  setAudioDucking(false, 1.0);
  isPlayingVoice = false;

  // Process next item in speech queue
  if (speechQueue.length > 0) {
    setTimeout(() => processSpeechQueue(), 100);
  }
}

function setAudioDucking(duck: boolean, targetLevel: number) {
  if (!tabGainNode || !audioCtx) return;
  isAudioDucking = duck;

  const now = audioCtx.currentTime;
  const timeConstant = duck ? 0.08 : 0.28; // Duck quickly (80ms), restore gently (280ms)
  tabGainNode.gain.setTargetAtTime(targetLevel, now, timeConstant);
}

function stopCapture() {
  isDubbingActive = false;
  isAudioDucking = false;
  isPlayingVoice = false;
  isProcessingChunk = false;
  speechQueue.length = 0;

  if (audioMeterInterval) {
    clearInterval(audioMeterInterval);
    audioMeterInterval = null;
  }

  if (mediaRecorder) {
    try {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    } catch (_) {}
    mediaRecorder = null;
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
